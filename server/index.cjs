'use strict';
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {validateState,checkMutation,summary,error}=require('./ledger.cjs');
const {createLimiter}=require('./security.cjs');
const {createMailer,logMailFailure}=require('./mail.cjs');
const {createAccounts,publicUser}=require('./accounts.cjs');
const root=path.join(__dirname,'..');
for(const line of (fs.existsSync(path.join(root,'.env'))?fs.readFileSync(path.join(root,'.env'),'utf8'):'').split(/\r?\n/)){
  const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const env=process.env;
const port=Number(env.PORT||3000),origin=(env.PUBLIC_ORIGIN||`http://localhost:${port}`).replace(/\/$/,'');
if(env.NODE_ENV==='production' && (!origin.startsWith('https://') || new URL(origin).origin!==origin))throw Error('Production PUBLIC_ORIGIN must be an HTTPS origin.');
if(env.NODE_ENV&&!['development','test','production'].includes(env.NODE_ENV))throw Error('NODE_ENV must be development, test or production.');
if(new URL(origin).origin!==origin||!['http:','https:'].includes(new URL(origin).protocol))throw Error('PUBLIC_ORIGIN must be an exact HTTP(S) origin.');
if(env.COOKIE_SECURE&&!['true','false'].includes(env.COOKIE_SECURE))throw Error('COOKIE_SECURE must be true or false.');
const secure=env.COOKIE_SECURE==='true'||origin.startsWith('https://');
const {pool}=require('./database.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const pad=x=>String(x).toLowerCase().trim();
const email=x=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim());
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max;
function json(res,code,value){const out=Buffer.from(JSON.stringify(value));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Length':out.length});res.end(out);}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>262144)error(413,'Request is too large.');chunks.push(c);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))error(400,'Invalid JSON body.');return value;}catch(e){error(400,'Invalid JSON body.');}}
const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`cp_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure?'; Secure':''}`);
const tokenFrom=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cp_session='))?.slice(11);
async function signedIn(req,q=pool){const t=tokenFrom(req);if(!t||!/^[a-f0-9]{64}$/.test(t))return null;
  const {rows}=await q.query('SELECT u.id,u.email,u.name,u.email_verified_at,u.verification_required FROM cp_users u JOIN cp_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.account_status=\'active\'', [sha(t)]);return rows[0]||null;}
function auth(req){if(!req.user)error(401,'Sign in first.');return req.user;}
async function workspace(userId,q=pool,lock=false){const {rows}=await q.query(`SELECT * FROM cp_workspaces WHERE owner_id=$1 OR member_id=$1 ${lock?'FOR UPDATE':''}`,[userId]);
  const w=rows[0];return w?{...w,role:w.owner_id===userId?'owner':'member'}:null;}
async function activeAccount(q,id){const r=await q.query('SELECT account_status FROM cp_users WHERE id=$1 FOR SHARE',[id]);if(r.rows[0]?.account_status!=='active')error(401,'Sign in first.');}
function requireWork(w){if(!w)error(403,'No active workspace.');return w;}
async function names(w,q=pool){const {rows}=await q.query(`SELECT u.id,COALESCE(p.display_name,u.name) AS name FROM cp_users u LEFT JOIN cp_profiles p ON p.user_id=u.id WHERE u.id=$1 OR u.id=$2`,[w.owner_id,w.member_id]);
 const map=new Map(rows.map(r=>[r.id,r.name]));return {a:map.get(w.owner_id)||'Parent A',b:map.get(w.member_id)||'Parent B'};}
async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
async function session(res,userId,q=pool){const token=crypto.randomBytes(32).toString('hex');await q.query('INSERT INTO cp_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[sha(token),userId]);cookie(res,token,30*86400);}
const limit=createLimiter(pool);
const mailer=createMailer(env,root);
// Behind a reverse proxy every request arrives from the proxy IP, which would put all users in one rate-limit bucket.
// TRUST_PROXY=true opts in to the LAST X-Forwarded-For entry (appended by your own proxy). Keep it false when the app is reachable directly.
if(env.TRUST_PROXY&&!['true','false'].includes(env.TRUST_PROXY))throw Error('TRUST_PROXY must be true or false.');
const clientIp=req=>{
 if(env.TRUST_PROXY==='true'){const parts=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);const last=parts[parts.length-1];if(last&&last.length<=64&&/^[0-9a-fA-F:.]+$/.test(last))return last;}
 return req.socket.remoteAddress;
};
const accounts=createAccounts({pool,transaction,body,json,error,email,text,origin,session,cookie,limit,mailer,env,workspace,clientIp});
for(const key of ['AUTH_RATE_LIMIT_MAX','TOKEN_RATE_LIMIT_MAX','EMAIL_RATE_LIMIT_MAX']){
 if(env[key]&&(!Number.isInteger(Number(env[key]))||Number(env[key])<1||Number(env[key])>10000))throw Error(key+' must be an integer from 1 to 10000.');
}
if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT is invalid.');
if(!Number.isInteger(Number(env.PGPOOL_MAX||10))||Number(env.PGPOOL_MAX||10)<1||Number(env.PGPOOL_MAX||10)>100)throw Error('PGPOOL_MAX must be 1 to 100.');
if(env.SUPPORT_URL){const support=new URL(env.SUPPORT_URL);if(!['https:','mailto:'].includes(support.protocol))throw Error('SUPPORT_URL must be HTTPS or mailto.');}
async function routes(req,res,url){
 const pathName=url.pathname,method=req.method;
 if(pathName==='/api/health'&&method==='GET'){await pool.query('SELECT 1');return json(res,200,{ok:true,database:'postgresql'});}
 req.user=await signedIn(req);
 if(pathName==='/api/session'&&method==='GET')return json(res,200,{user:req.user?publicUser(req.user):null});
 if(await accounts.handle(req,res,url))return;
 if(pathName==='/api/auth/logout'&&method==='POST'){
   const token=tokenFrom(req);if(token&&/^[a-f0-9]{64}$/.test(token))await pool.query('DELETE FROM cp_sessions WHERE token_hash=$1',[sha(token)]);
   cookie(res,'',0);return json(res,200,{ok:true});
 }
 const u=auth(req);
 if(pathName==='/api/workspace'&&method==='GET'){
   const w=await workspace(u.id);return json(res,200,w?{exists:true,state:w.state,revision:Number(w.revision),role:w.role,shared:!!w.member_id,archived:!!w.archived_at,profileNames:await names(w)}:{exists:false});
 }
 if(pathName==='/api/workspace'&&method==='POST'){
   await transaction(async q=>{
     const active=await q.query('SELECT account_status FROM cp_users WHERE id=$1 FOR UPDATE',[u.id]);if(active.rows[0]?.account_status!=='active')error(401,'Sign in first.');
     if(await workspace(u.id,q))error(409,'This user already belongs to a workspace.');
     await q.query('INSERT INTO cp_workspaces(id,owner_id) VALUES($1,$2)',[uid(),u.id]);
   });
   return json(res,201,{created:true});
 }
 if(pathName==='/api/workspace'&&method==='PUT'){
   const data=await body(req);validateState(data.state);
   if(!Number.isSafeInteger(data.revision)||data.revision<0)error(400,'Invalid workspace revision.');
   const next=await transaction(async q=>{
     await activeAccount(q,u.id);
     const w=requireWork(await workspace(u.id,q,true));if(w.archived_at)error(403,'This workspace is archived and read-only.');if(Number(w.revision)!==data.revision)error(409,'Your co-parent has updated the workspace. Please reload.');
     checkMutation(w.state,data.state,u.id,w.owner_id,w.role);
     const r=await q.query('UPDATE cp_workspaces SET state=$1::jsonb,revision=revision+1 WHERE id=$2 RETURNING revision',[JSON.stringify(data.state),w.id]);return Number(r.rows[0].revision);
   });return json(res,200,{revision:next});
 }
 // Invitation acceptance must work for a signed-in user who has NO workspace yet.
 const inviteRoute=pathName.match(/^\/api\/invite\/([a-f0-9]{64})(?:\/(join))?$/);
 if(inviteRoute&&method==='GET'&&!inviteRoute[2]){
   const {rows}=await pool.query('SELECT accepted_at,revoked_at,expires_at FROM cp_invitations WHERE token_hash=$1',[sha(inviteRoute[1])]);
   const inv=rows[0];return json(res,200,{status:!inv?'invalid':inv.accepted_at?'accepted':inv.revoked_at?'revoked':new Date(inv.expires_at)<new Date()?'expired':'open',expiresAt:inv?.expires_at||null});
 }
 if(inviteRoute&&method==='POST'&&inviteRoute[2]==='join'){
   accounts.requireVerified(u);
   const joined=await transaction(async q=>{
     const active=await q.query('SELECT account_status FROM cp_users WHERE id=$1 FOR UPDATE',[u.id]);if(active.rows[0]?.account_status!=='active')error(401,'Sign in first.');
     const {rows}=await q.query('SELECT * FROM cp_invitations WHERE token_hash=$1 FOR UPDATE',[sha(inviteRoute[1])]);const invite=rows[0];
     if(!invite||invite.accepted_at||invite.revoked_at||new Date(invite.expires_at)<=new Date())error(409,'Invitation is no longer valid.');
     if(invite.invited_email!==u.email)error(403,'Sign in with the invited email.');
     if(await workspace(u.id,q))error(409,'This account already belongs to a workspace.');
     const {rows:wr}=await q.query('SELECT * FROM cp_workspaces WHERE id=$1 FOR UPDATE',[invite.workspace_id]);const current=wr[0];
     if(!current||current.archived_at||current.member_id||current.owner_id===u.id)error(409,'Co-parent slot unavailable.');
     await q.query('UPDATE cp_workspaces SET member_id=$1,revision=revision+1 WHERE id=$2',[u.id,current.id]);
     await q.query('UPDATE cp_invitations SET accepted_at=now() WHERE id=$1',[invite.id]);return true;
   });return json(res,200,{joined});
 }
 const w=requireWork(await workspace(u.id));
 if(pathName==='/api/profile'&&method==='GET'){
   const {rows}=await pool.query('SELECT display_name,avatar_color FROM cp_profiles WHERE user_id=$1',[u.id]);const p=rows[0];
   return json(res,200,{displayName:p?.display_name||u.name,avatarColor:p?.avatar_color||'teal',email:u.email,role:w.role,customized:!!p});
 }
 if(pathName==='/api/profile'&&method==='PUT'){
   const x=await body(req);if(!text(x.displayName,50)||!['teal','blue','violet','coral'].includes(x.avatarColor))error(400,'Invalid profile.');
   await transaction(async q=>{await activeAccount(q,u.id);await q.query(`INSERT INTO cp_profiles(user_id,display_name,avatar_color) VALUES($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,avatar_color=excluded.avatar_color`,[u.id,x.displayName.trim(),x.avatarColor]);});
   return json(res,200,{saved:true,displayName:x.displayName.trim(),avatarColor:x.avatarColor});
 }
 if(pathName==='/api/profile'&&method==='DELETE'){
   await transaction(async q=>{await activeAccount(q,u.id);await q.query('DELETE FROM cp_profiles WHERE user_id=$1',[u.id]);});return json(res,200,{deleted:true,note:'Only custom profile data removed. Workspace and account retained.'});
 }
 if(pathName==='/api/notifications'&&method==='GET'){
   const items=w.state.expenses.filter(e=>(e.createdBy||w.owner_id)!==u.id&&e.createdAt&&Number.isFinite(Date.parse(e.createdAt)))
     .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,30);
   const ids=items.map(i=>i.id),seen=new Set();
   if(ids.length){const {rows}=await pool.query('SELECT expense_id FROM cp_notification_reads WHERE user_id=$1 AND expense_id=ANY($2::text[])',[u.id,ids]);for(const x of rows)seen.add(x.expense_id);}
   const mapped=items.map(e=>({id:e.id,description:e.description,amount:e.amount,parent:e.payer,createdAt:e.createdAt,read:seen.has(e.id)}));
   return json(res,200,{items:mapped,unread:mapped.filter(e=>!e.read).length,...summary(w.state,w.role==='owner'?'a':'b'),revision:Number(w.revision)});
 }
 if(pathName==='/api/notifications/read'&&method==='POST'){
   const x=await body(req);if(!Array.isArray(x.ids)||x.ids.length>40||x.ids.some(i=>typeof i!=='string'||i.length>80))error(400,'Invalid IDs.');
   const valid=new Set(w.state.expenses.filter(e=>(e.createdBy||w.owner_id)!==u.id).map(e=>e.id));
   await transaction(async q=>{await activeAccount(q,u.id);for(const id of x.ids)if(valid.has(id))await q.query('INSERT INTO cp_notification_reads(user_id,expense_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[u.id,id]);});
   return json(res,200,{updated:true});
 }
 if(pathName==='/api/invite'&&method==='POST'){
   accounts.requireVerified(u);if(w.archived_at)error(403,'Archived workspace.');
   if(w.role!=='owner'||w.member_id)error(403,'Only the workspace owner can invite one co-parent.');
   const x=await body(req);if(!email(x.email))error(400,'Invalid invitation email.');const token=crypto.randomBytes(32).toString('hex');
   await transaction(async q=>{await activeAccount(q,u.id);const current=requireWork(await workspace(u.id,q,true));if(current.role!=='owner'||current.member_id||current.archived_at)error(403,'Workspace cannot accept an invitation.');
   await q.query('INSERT INTO cp_invitations(id,workspace_id,invited_email,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval \'7 days\')',[uid(),w.id,pad(x.email),sha(token)]);
   });
   return json(res,200,{code:token});
 }
 if(pathName==='/api/member/remove'&&method==='POST'){
   accounts.requireVerified(u);if(w.archived_at)error(403,'Archived workspace.');
   if(w.role!=='owner')error(403,'Only owner can remove co-parent.');
   await transaction(async q=>{await activeAccount(q,u.id);const {rows}=await q.query('SELECT member_id FROM cp_workspaces WHERE id=$1 FOR UPDATE',[w.id]);if(!rows[0]?.member_id)error(400,'No connected co-parent.');
     await q.query('UPDATE cp_workspaces SET member_id=NULL,revision=revision+1 WHERE id=$1',[w.id]);
     await q.query('UPDATE cp_invitations SET revoked_at=now() WHERE workspace_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL',[w.id]);});
   return json(res,200,{removed:true});
 }
 if(pathName==='/api/email/status'&&method==='GET')return json(res,200,{configured:mailer.configured()});
 if(pathName==='/api/email/invite'&&method==='POST'){
   accounts.requireVerified(u);if(w.archived_at)error(403,'Archived workspace.');
   await limit('invite-email',u.id,10,3600);
   if(w.role!=='owner'||w.member_id)error(403,'Only unpaired workspace owners can invite.');
   if(!mailer.configured())error(503,'Email delivery is not configured. Copy the invite link instead.');
   const x=await body(req);if(!email(x.email)||typeof x.code!=='string'||!/^[a-f0-9]{64}$/.test(x.code))error(400,'Invalid invitation details.');
   const {rows}=await pool.query('SELECT * FROM cp_invitations WHERE token_hash=$1 AND workspace_id=$2',[sha(x.code),w.id]);
   const invite=rows[0];if(!invite||invite.invited_email!==pad(x.email)||invite.accepted_at||invite.revoked_at||new Date(invite.expires_at)<=new Date())error(400,'Invitation invalid or expired.');
   let inviteUrl;try{inviteUrl=new URL(String(x.url));}catch{error(400,'Invalid invite URL.');}
   const permittedOrigins=[origin,...(env.NODE_ENV!=='production'?['http://localhost:5173','http://127.0.0.1:5173']:[])];
   if(!permittedOrigins.includes(inviteUrl.origin)||inviteUrl.hash.indexOf(x.code)===-1)error(400,'Invalid invite URL.');
   try{await mailer.send({to:invite.invited_email,subject:'CoParent shared workspace invitation',text:'Join your shared workspace: '+inviteUrl.toString()+'\nInvitation expires after 7 days.'});}catch(e){logMailFailure('invite',e);error(502,'Email delivery failed. Retry or copy the link.');}
   return json(res,200,{accepted:true});
 }
 error(404,'API endpoint not found.');
}
function staticFile(req,res,pathname){
 const rel=pathname==='/'?'index.html':pathname.slice(1);
 if(!/^[a-zA-Z0-9_./-]+$/.test(rel)||rel.includes('..')||rel.split('/').some(part=>part.startsWith('.')))return json(res,404,{error:'Not found.'});
 let file=path.join(root,'dist',rel);if(!fs.existsSync(file)&&!path.extname(rel))file=path.join(root,'dist','index.html');
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found. If the app was never built, run npm run build.'});
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
 const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",'Content-Length':data.length,'Cache-Control':/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(rel)?'public, max-age=31536000, immutable':'no-cache'});res.end(data);
}
const app=http.createServer(async(req,res)=>{
 const requestId=uid();res.setHeader('X-Request-ID',requestId);
 try{
   res.setHeader('Referrer-Policy','no-referrer');
   res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
   if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
   const url=new URL(req.url,origin);
   if(!['GET','HEAD'].includes(req.method)){
     const requestOrigin=req.headers.origin;
     // In development, Vite's proxy carries the browser Origin from port 5173.
     if(requestOrigin&&requestOrigin!==origin&&!(env.NODE_ENV!=='production'&&['http://localhost:5173','http://127.0.0.1:5173'].includes(requestOrigin)))error(403,'Cross-origin write rejected.');
     if(!requestOrigin&&req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')error(403,'Cross-site write rejected.');
   }
   if(url.pathname.startsWith('/api/'))await routes(req,res,url);
   else if(['GET','HEAD'].includes(req.method))staticFile(req,res,url.pathname);
   else error(405,'Method not supported.');
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Unexpected server error.'});if(!e.status)console.error(JSON.stringify({level:'error',event:'request_failed',requestId,code:typeof e.code==='string'?e.code:'INTERNAL'}));}
});
app.requestTimeout=30000;app.headersTimeout=15000;app.keepAliveTimeout=5000;app.maxHeadersCount=64;
async function start(){if(!env.DATABASE_URL)throw Error('DATABASE_URL missing in .env');
 if(env.MIGRATE_ON_START==='true'||(env.NODE_ENV!=='production'&&env.MIGRATE_ON_START!=='false')){
   const schema=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');await transaction(async q=>{await q.query('SELECT pg_advisory_xact_lock(724631864)');await q.query(schema);});
 }else{const r=await pool.query("SELECT to_regclass('cp_action_tokens') AS table");if(!r.rows[0].table)throw Error('Schema missing. Run npm run db:migrate using the migration role.');}
 await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(port,()=>{app.removeListener('error',reject);console.log(`CoParent PostgreSQL API ready on ${origin}`);resolve();});});}
let closing=false;
async function shutdown(){if(closing)return;closing=true;const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();app.closeIdleConnections();await new Promise(resolve=>app.close(resolve));await pool.end();clearTimeout(timeout);}
if(require.main===module){process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());}
if(require.main===module)start().catch(async e=>{console.error('[startup]',e.message);await pool.end();process.exitCode=1;});
module.exports={app,pool,start,shutdown};
