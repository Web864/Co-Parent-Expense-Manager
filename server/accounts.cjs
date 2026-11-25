'use strict';
const crypto=require('node:crypto');
const {hashPassword,passwordMatches,passwordValid,sha}=require('./security.cjs');
const {logMailFailure}=require('./mail.cjs');
const GENERIC='If the address is eligible, an email will arrive with the next steps. Check your inbox and spam folder.';
const DEV_NOTICE=' Development mail mode: no real email is sent. Messages are saved only to the private local mail sink on this machine.';
const POLICY_VERSION='2026-11-24-draft';
const tokenValid=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
const publicUser=u=>({userId:u.id,email:u.email,name:u.name,emailVerified:!!u.email_verified_at,legacyAccess:!u.verification_required});
const verified=u=>!!u.email_verified_at||!u.verification_required;
function requireVerified(u,error){if(!verified(u))error(403,'Verify your email before using this account feature.');}
function createAccounts({pool,transaction,body,json,error,email,text,origin,session,cookie,limit,mailer,env,workspace,clientIp=r=>r.socket.remoteAddress}){
 const max=Number(env.AUTH_RATE_LIMIT_MAX||18);
 async function authLimit(req,action){await limit(action+'-ip',clientIp(req),max,900);}
 async function issue(user,kind){
  const token=crypto.randomBytes(32).toString('hex');
  const issued=await transaction(async q=>{
   const {rows}=await q.query('SELECT * FROM cp_users WHERE id=$1 FOR UPDATE',[user.id]);const current=rows[0];
   if(!current||current.account_status!=='active'||(kind==='verify'&&current.email_verified_at))return false;
   await q.query('UPDATE cp_action_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL',[current.id,kind]);
   await q.query("INSERT INTO cp_action_tokens(token_hash,user_id,kind,email,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 minute')",[sha(token),current.id,kind,current.email,kind==='verify'?1440:30]);return true;
  });
  if(!issued)return;
  // Fragment tokens are not sent as HTTP URL paths, query strings or Referrer headers.
  const link=origin+'/#/account/'+kind+'?token='+token;
  setImmediate(()=>{void mailer.send({to:user.email,subject:kind==='verify'?'Verify your CoParent email':'Reset your CoParent password',text:(kind==='verify'?'Verify your email within 24 hours: ':'Reset your password within 30 minutes: ')+link+'\nIf you did not request this, ignore this message.'}).catch(e=>logMailFailure(kind,e));});
 }
 async function consume(req,x,kind){
  await limit(kind+'-submit',clientIp(req),Number(env.TOKEN_RATE_LIMIT_MAX||20),900);
  if(!tokenValid(x.token))error(400,'This link is invalid, expired or already used. Request a new link.');
  if(kind==='reset'&&!passwordValid(x.password))error(400,'Use a password between 10 and 128 characters.');
  const found=await pool.query('SELECT user_id FROM cp_action_tokens WHERE token_hash=$1 AND kind=$2',[sha(x.token),kind]);
  if(!found.rows[0])error(400,'This link is invalid, expired or already used. Request a new link.');
  const newHash=kind==='reset'?await hashPassword(x.password):null;
  await transaction(async q=>{
   const {rows}=await q.query('SELECT * FROM cp_users WHERE id=$1 FOR UPDATE',[found.rows[0].user_id]);const u=rows[0];
   const result=await q.query('SELECT * FROM cp_action_tokens WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[sha(x.token),kind]);const token=result.rows[0];
   if(!u||u.account_status!=='active'||!token||token.email!==u.email||(kind==='verify'&&u.email_verified_at))error(400,'This link is invalid, expired or already used. Request a new link.');
   if(kind==='verify'&&req.user&&req.user.id!==u.id)error(403,'This link belongs to another account. Sign out before continuing.');
   if(kind==='verify')await q.query('UPDATE cp_users SET email_verified_at=now() WHERE id=$1',[u.id]);
   else{await q.query('UPDATE cp_users SET password_hash=$1 WHERE id=$2',[newHash,u.id]);await q.query('DELETE FROM cp_sessions WHERE user_id=$1',[u.id]);}
   await q.query('UPDATE cp_action_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL',[u.id,kind]);
  });
 }
 async function handle(req,res,url){
  const p=url.pathname,m=req.method;
  if(p==='/api/public/config'&&m==='GET'){json(res,200,{supportUrl:env.SUPPORT_URL||null,policyVersion:POLICY_VERSION,policiesDraft:true});return true;}
  if(p==='/api/auth/signup'&&m==='POST'){
   await authLimit(req,'signup');const x=await body(req);
   if(!email(x.email)||!text(x.name,50)||!passwordValid(x.password)||x.policyAcknowledged!==true||x.policyVersion!==POLICY_VERSION)error(400,'Enter a name, valid email, password of 10 to 128 characters, and acknowledge the draft policies.');
   const address=x.email.trim().toLowerCase(),hash=await hashPassword(x.password),id=crypto.randomUUID();
   const result=await pool.query(`INSERT INTO cp_users(id,email,name,password_hash,verification_required,policy_acknowledged_at,policy_version) VALUES($1,$2,$3,$4,true,now(),$5) ON CONFLICT(email) DO NOTHING RETURNING id,email`,[id,address,x.name.trim(),hash,POLICY_VERSION]);
   if(result.rows[0])await issue(result.rows[0],'verify');
   json(res,201,{message:GENERIC+(mailer.mode==='development'?DEV_NOTICE:'')});return true;
  }
  if(p==='/api/auth/login'&&m==='POST'){
   await authLimit(req,'login');const x=await body(req);
   if(!email(x.email)||typeof x.password!=='string'||x.password.length>128)error(400,'Enter valid login details.');
   await limit('login-email',x.email.trim().toLowerCase(),max,900);
   const result=await pool.query('SELECT * FROM cp_users WHERE email=$1',[x.email.trim().toLowerCase()]),u=result.rows[0];
   const matches=await passwordMatches(x.password,u?.password_hash);
   if(!u||u.account_status!=='active'||!matches)error(401,'Incorrect email or password.');
   await transaction(async q=>{
    const r=await q.query('SELECT * FROM cp_users WHERE id=$1 FOR UPDATE',[u.id]),current=r.rows[0];
    if(!current||current.account_status!=='active'||current.password_hash!==u.password_hash)error(401,'Incorrect email or password.');
    await session(res,u.id,q);
   });json(res,200,{user:publicUser(u)});return true;
  }
  if(['/api/auth/forgot-password','/api/auth/resend-verification'].includes(p)&&m==='POST'){
   const began=Date.now();const kind=p.endsWith('forgot-password')?'reset':'verify';await authLimit(req,kind+'-request');const x=await body(req);
   if(email(x.email)){
    const address=x.email.trim().toLowerCase();await limit(kind+'-email',address,Number(env.EMAIL_RATE_LIMIT_MAX||3),3600);
    const {rows}=await pool.query("SELECT id,email FROM cp_users WHERE email=$1 AND account_status='active'",[address]);if(rows[0])await issue(rows[0],kind);
   }
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,200-(Date.now()-began))));
   json(res,202,{message:GENERIC+(mailer.mode==='development'?DEV_NOTICE:'')});return true;
  }
  if(['/api/auth/verify-email','/api/auth/reset-password'].includes(p)&&m==='POST'){
   const kind=p.endsWith('verify-email')?'verify':'reset';await consume(req,await body(req),kind);
   if(kind==='reset')cookie(res,'',0);
   json(res,200,{message:kind==='verify'?'Your email is verified. You can continue to your workspace.':'Password reset complete. All previous sessions have been signed out. Sign in with your new password.'});return true;
  }
  if(!p.startsWith('/api/account'))return false;
  if(!req.user)error(401,'Sign in first.');const u=req.user;
  if(p==='/api/account'&&m==='GET'){
   const {rows}=await pool.query('SELECT id,status,requested_at,completed_at FROM cp_deletion_requests WHERE user_id=$1',[u.id]);
   json(res,200,{...publicUser(u),emailDeliveryConfigured:mailer.configured(),deletionRequest:rows[0]||null,policyVersion:POLICY_VERSION});return true;
  }
  requireVerified(u,error);
  if(p==='/api/account/export'&&m==='GET'){
   await limit('account-export',u.id,10,3600);
   const data=await transaction(async q=>{
    const {rows}=await q.query('SELECT id,email,name,email_verified_at,verification_required,created_at,policy_acknowledged_at,policy_version,account_status FROM cp_users WHERE id=$1 FOR SHARE',[u.id]);
    if(rows[0]?.account_status!=='active')error(401,'Sign in first.');
    const profile=await q.query('SELECT display_name,avatar_color FROM cp_profiles WHERE user_id=$1',[u.id]);
    const w=await workspace(u.id,q,true);
    const reads=await q.query('SELECT expense_id,seen_at FROM cp_notification_reads WHERE user_id=$1',[u.id]);
    const request=await q.query('SELECT id,status,requested_at,completed_at FROM cp_deletion_requests WHERE user_id=$1',[u.id]);
    return {schemaVersion:1,exportedAt:new Date().toISOString(),account:rows[0],profile:profile.rows[0]||null,membership:w?{workspaceId:w.id,role:w.role,archived:!!w.archived_at}:null,sharedWorkspace:w?{state:w.state,revision:Number(w.revision)}:null,createdExpenses:w?w.state.expenses.filter(e=>(e.createdBy||w.owner_id)===u.id):[],createdReimbursements:w?w.state.payments.filter(e=>(e.createdBy||w.owner_id)===u.id):[],notificationReads:reads.rows,deletionRequest:request.rows[0]||null};
   });json(res,200,data);return true;
  }
  if(p==='/api/account/deletion-request'&&m==='POST'){
   await limit('deletion-request',u.id,5,3600);const x=await body(req);
   if(x.confirmation!=='REQUEST DELETION'||typeof x.password!=='string'||x.password.length>128)error(400,'Enter your current password and the exact confirmation REQUEST DELETION.');
   const result=await transaction(async q=>{
    const {rows}=await q.query('SELECT * FROM cp_users WHERE id=$1 FOR UPDATE',[u.id]);const current=rows[0];
    if(!current||current.account_status!=='active'||!await passwordMatches(x.password,current.password_hash))error(401,'Incorrect current password.');
    const r=await q.query('INSERT INTO cp_deletion_requests(id,user_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id,status,requested_at',[crypto.randomUUID(),u.id]);return r.rows[0];
   });json(res,200,{request:result,message:'Deletion request recorded for operator review. Your account remains active until completion. Shared financial history will be retained or reviewed, not silently erased. Keep your request reference and contact the service operator.'});return true;
  }
  error(404,'Account endpoint not found.');
 }
 return {handle,requireVerified:u=>requireVerified(u,error)};
}
module.exports={createAccounts,publicUser,verified,POLICY_VERSION};
