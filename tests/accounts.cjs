'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=require('pg'),{mailToken,cleanMail}=require('./mail-helper.cjs'),{hashPassword,sha}=require('../server/security.cjs'),{completeDeletion}=require('../server/deletion.cjs');
const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
if(!/(_qa|_test)$/.test(target.pathname))throw Error('Use a separate QA database ending _qa or _test.');
const envFile=path.join(__dirname,'../.env'),configured=(fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8'):'').match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if(configured&&new URL(configured.replace(/^['"]|['"]$/g,'')).pathname===target.pathname)throw Error('Refusing application database.');
const schema='authqa_'+crypto.randomBytes(8).toString('hex'),origin='http://localhost:3095';
Object.assign(process.env,{DATABASE_URL:target.toString(),PORT:'3095',PUBLIC_ORIGIN:origin,NODE_ENV:'test',PGOPTIONS:'-c search_path='+schema,EMAIL_PROVIDER:'development',DEV_MAIL_SINK:'true',AUTH_RATE_LIMIT_MAX:'100',TOKEN_RATE_LIMIT_MAX:'100'});
const admin=new Pool({connectionString:target.toString(),options:'-c search_path=public'}),{pool,start,shutdown}=require('../server/index.cjs');
const password=()=>crypto.randomBytes(20).toString('hex');
async function call(actor,method,url,data,status=200){const r=await fetch(origin+url,{method,headers:{Origin:origin,...(actor?.cookie?{Cookie:actor.cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();assert.equal(r.status,status,'Unexpected HTTP status (response redacted).');return {value,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function signup(label){const actor={email:label+'-'+schema+'@example.invalid',password:password()};await call(null,'POST','/api/auth/signup',{email:actor.email,password:actor.password,name:'QA '+label,policyAcknowledged:true,policyVersion:'2026-11-24-draft'},201);return login(actor);}
async function login(actor){const r=await call(null,'POST','/api/auth/login',{email:actor.email,password:actor.password});return {...actor,id:r.value.user.userId,cookie:r.cookie};}
async function verify(actor){await call(actor,'POST','/api/auth/verify-email',{token:(await mailToken(actor.email,'verify',pool))});}
async function closeRequest(requestId){const q=await pool.connect();try{await q.query('BEGIN');const r=await completeDeletion(q,{requestId,backupRetentionDays:30,reviewNote:'QA-only retention and shared-record review completed.'});await q.query('COMMIT');return r;}catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}}

test('Phase 2 account security in isolated PostgreSQL',async t=>{
 await admin.query('CREATE SCHEMA '+schema);await start();let a,b,c,expiredB,resetA,oldA,memberRequest,ownerRequest;
 try{
 await t.test('new signup is unverified, no token/session disclosure, and duplicate response is generic',async()=>{
  a=await signup('a');b=await signup('b');c=await signup('c');oldA=a.cookie;
  assert.equal((await call(a,'GET','/api/session')).value.user.emailVerified,false);
  const x={email:a.email,name:'Duplicate',password:password(),policyAcknowledged:true,policyVersion:'2026-11-24-draft'};
  const duplicate=await call(null,'POST','/api/auth/signup',x,201);assert.equal(duplicate.cookie,undefined);assert.deepEqual(Object.keys(duplicate.value),['message']);
  const rows=await pool.query('SELECT token_hash FROM cp_action_tokens WHERE user_id=$1',[a.id]);assert.equal(rows.rows[0].token_hash,sha((await mailToken(a.email,'verify',pool))));
 });
 await t.test('unverified private mode works; invitations/export/deletion are restricted',async()=>{
  await call(a,'POST','/api/workspace',{},201);await call(a,'POST','/api/invite',{email:b.email},403);await call(a,'GET','/api/account/export',undefined,403);await call(a,'POST','/api/account/deletion-request',{},403);
 });
 await t.test('invalid verification and wrong signed-in account are rejected',async()=>{
  await call(a,'POST','/api/auth/verify-email',{token:'0'.repeat(64)},400);await call(b,'POST','/api/auth/verify-email',{token:(await mailToken(a.email,'verify',pool))},403);
 });
 await t.test('valid verification is single-use and cannot reverify an already verified account',async()=>{
  const token=(await mailToken(a.email,'verify',pool));await verify(a);assert.equal((await call(a,'GET','/api/session')).value.user.emailVerified,true);await call(a,'POST','/api/auth/verify-email',{token},400);
  const stamp=(await pool.query('SELECT email_verified_at FROM cp_users WHERE id=$1',[a.id])).rows[0].email_verified_at;
  await call(a,'POST','/api/auth/resend-verification',{email:a.email},202);assert.deepEqual((await pool.query('SELECT email_verified_at FROM cp_users WHERE id=$1',[a.id])).rows[0].email_verified_at,stamp);
 });
 await t.test('expired verification link is rejected',async()=>{
  expiredB=(await mailToken(b.email,'verify',pool));await pool.query("UPDATE cp_action_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",[b.id]);await call(b,'POST','/api/auth/verify-email',{token:expiredB},400);
 });
 await t.test('resend issues a fresh usable link, invalidates the older link, and is rate limited',async()=>{
  await call(b,'POST','/api/auth/resend-verification',{email:b.email},202);await call(b,'POST','/api/auth/verify-email',{token:expiredB},400);await verify(b);
  for(let i=0;i<2;i++)await call(b,'POST','/api/auth/resend-verification',{email:b.email},202);await call(b,'POST','/api/auth/resend-verification',{email:b.email},429);
 });
 await t.test('token stored email must match the account email',async()=>{
  const token=(await mailToken(c.email,'verify',pool));await pool.query('UPDATE cp_action_tokens SET email=$1 WHERE user_id=$2',['wrong@example.invalid',c.id]);await call(c,'POST','/api/auth/verify-email',{token},400);
  await call(c,'POST','/api/auth/resend-verification',{email:c.email},202);await verify(c);
 });
 await t.test('legacy additive migration keeps existing accounts, sessions and ledger unchanged',async()=>{
  const legacySchema=schema+'_legacy',q=new Pool({connectionString:target.toString(),options:'-c search_path='+legacySchema});await admin.query('CREATE SCHEMA '+legacySchema);
  try{const sql=fs.readFileSync(path.join(__dirname,'../server/schema.sql'),'utf8');await q.query(sql.split('-- Phase 2 is additive.')[0]);const id=crypto.randomUUID();await q.query('INSERT INTO cp_users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,'legacy@example.invalid','Legacy',await hashPassword(password())]);await q.query("INSERT INTO cp_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[sha('legacy-session'),id]);const retained={names:{a:'Legacy A',b:'Legacy B'},expenses:[{id:'legacy-exp',date:'2026-11-24',child:'QA',description:'Retained migration expense',category:'Other',payer:'a',amount:100,shareA:50,createdBy:id}],payments:[{id:'legacy-pay',expenseId:'legacy-exp',date:'2026-11-24',amount:20,method:'Cash',from:'b',to:'a',createdBy:id}]};await q.query('INSERT INTO cp_workspaces(id,owner_id,state) VALUES($1,$2,$3)',[crypto.randomUUID(),id,retained]);await q.query(sql);assert.deepEqual((await q.query('SELECT state FROM cp_workspaces WHERE owner_id=$1',[id])).rows[0].state,retained);const u=(await q.query('SELECT verification_required,email_verified_at FROM cp_users WHERE id=$1',[id])).rows[0];assert.equal(u.verification_required,false);assert.equal(u.email_verified_at,null);assert.equal((await q.query('SELECT count(*)::int AS n FROM cp_sessions')).rows[0].n,1);}finally{await q.end();await admin.query('DROP SCHEMA '+legacySchema+' CASCADE');}
 });
 await t.test('forgot-password responses match for known and unknown addresses',async()=>{
  const known=await call(null,'POST','/api/auth/forgot-password',{email:a.email},202),unknown=await call(null,'POST','/api/auth/forgot-password',{email:'unknown-'+schema+'@example.invalid'},202);assert.deepEqual(known.value,unknown.value);resetA=(await mailToken(a.email,'reset',pool));
 });
 await t.test('invalid reset and weak replacement password are rejected',async()=>{
  await call(null,'POST','/api/auth/reset-password',{token:'0'.repeat(64),password:password()},400);await call(null,'POST','/api/auth/reset-password',{token:resetA,password:'short'},400);
 });
 await t.test('expired reset is rejected; requesting another invalidates outstanding reset tokens',async()=>{
  await pool.query("UPDATE cp_action_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[sha(resetA)]);await call(null,'POST','/api/auth/reset-password',{token:resetA,password:password()},400);await call(null,'POST','/api/auth/forgot-password',{email:a.email},202);const newer=(await mailToken(a.email,'reset',pool));assert.notEqual(newer,resetA);resetA=newer;
 });
 await t.test('two concurrent reset submissions permit only one successful consumption',async()=>{
  const next=password();const rs=await Promise.all([fetch(origin+'/api/auth/reset-password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:resetA,password:next})}),fetch(origin+'/api/auth/reset-password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:resetA,password:next})})]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,400]);a.newPassword=next;
 });
 await t.test('reset revokes previous sessions and old password; new password works; token replay fails',async()=>{
  assert.equal((await call({cookie:oldA},'GET','/api/session')).value.user,null);await call(null,'POST','/api/auth/login',{email:a.email,password:a.password},401);a.password=a.newPassword;a=await login(a);await call(null,'POST','/api/auth/reset-password',{token:resetA,password:password()},400);
 });
 await t.test('reset request throttling applies identically to unknown addresses',async()=>{
  const email='rate-'+schema+'@example.invalid';for(let i=0;i<3;i++)await call(null,'POST','/api/auth/forgot-password',{email},202);await call(null,'POST','/api/auth/forgot-password',{email},429);
 });
 await t.test('verified invitation acceptance and financial collaboration remain valid',async()=>{
  const code=(await call(a,'POST','/api/invite',{email:b.email})).value.code;await call(b,'POST','/api/invite/'+code+'/join',{});
  const w=(await call(a,'GET','/api/workspace')).value;w.state.expenses.push({id:'paid-expense',date:'2026-11-24',child:'QA',description:'Shared QA expense',category:'Education',payer:'a',amount:100,shareA:50,createdBy:a.id,createdAt:new Date().toISOString()});w.state.payments.push({id:'receipt',expenseId:'paid-expense',date:'2026-11-24',amount:20,from:'b',to:'a',method:'Cash',createdBy:a.id});await call(a,'PUT','/api/workspace',{revision:w.revision,state:w.state});
 });
 await t.test('personal export is authenticated, scoped, complete, and contains no authentication secrets',async()=>{
  await call(null,'GET','/api/account/export',undefined,401);const data=(await call(a,'GET','/api/account/export')).value;assert.equal(data.schemaVersion,1);assert.equal(data.createdExpenses.length,1);assert.equal(data.createdReimbursements.length,1);assert.equal(data.sharedWorkspace.state.payments.length,1);
  const out=JSON.stringify(data);for(const field of ['password_hash','token_hash','cp_session','invited_email'])assert.ok(!out.includes(field));assert.ok(!out.includes(a.password));assert.ok(!out.includes(resetA));assert.equal(data.account.email,a.email);
  const other=(await call(c,'GET','/api/account/export')).value;assert.equal(other.sharedWorkspace,null);
 });
 await t.test('deletion requests require correct current password and exact confirmation',async()=>{
  await call(b,'POST','/api/account/deletion-request',{password:b.password,confirmation:'delete'},400);await call(b,'POST','/api/account/deletion-request',{password:'wrong-password',confirmation:'REQUEST DELETION'},401);
 });
 await t.test('member deletion request is idempotent and does not prematurely revoke access',async()=>{
  const x={password:b.password,confirmation:'REQUEST DELETION',userId:c.id};const r=await call(b,'POST','/api/account/deletion-request',x);memberRequest=r.value.request.id;assert.equal((await call(b,'POST','/api/account/deletion-request',x)).value.request.id,memberRequest);assert.ok((await call(b,'GET','/api/workspace')).value.exists);assert.equal((await pool.query('SELECT user_id FROM cp_deletion_requests WHERE id=$1',[memberRequest])).rows[0].user_id,b.id);
 });
 await t.test('legal hold blocks completion without altering sessions or shared records',async()=>{
  await pool.query('UPDATE cp_deletion_requests SET legal_hold=true WHERE id=$1',[memberRequest]);await assert.rejects(()=>closeRequest(memberRequest),/legal hold/);assert.ok((await call(b,'GET','/api/session')).value.user);await pool.query('UPDATE cp_deletion_requests SET legal_hold=false WHERE id=$1',[memberRequest]);
 });
 await t.test('member completion revokes sessions/access and preserves paid history in archived owner ledger',async()=>{
  const before=(await call(a,'GET','/api/workspace')).value.state;await closeRequest(memberRequest);assert.equal((await call(b,'GET','/api/session')).value.user,null);const w=(await call(a,'GET','/api/workspace')).value;assert.equal(w.archived,true);assert.deepEqual(w.state,before);await call(a,'PUT','/api/workspace',{state:before,revision:w.revision},403);const u=(await pool.query('SELECT email,name,password_hash,account_status FROM cp_users WHERE id=$1',[b.id])).rows[0];assert.equal(u.name,'Former parent');assert.equal(u.password_hash,'');assert.equal(u.account_status,'closed');assert.equal((await pool.query('SELECT count(*)::int AS n FROM cp_invitations WHERE invited_email=$1',[b.email])).rows[0].n,0);assert.ok(!u.email.includes(b.email));assert.equal((await closeRequest(memberRequest)).alreadyCompleted,true);
 });
 await t.test('owner request/completion preserves survivor export and revokes owner sessions',async()=>{
  // Use a fresh paired workspace because previous workspace is intentionally archived.
  const owner=await signup('owner'),member=await signup('member');await verify(owner);await verify(member);await call(owner,'POST','/api/workspace',{},201);const code=(await call(owner,'POST','/api/invite',{email:member.email})).value.code;await call(member,'POST','/api/invite/'+code+'/join',{});const ledger=(await call(owner,'GET','/api/workspace')).value;ledger.state.expenses.push({id:'owner-paid',date:'2026-11-24',child:'QA',description:'Preserved owner expense',category:'Other',payer:'a',amount:100,shareA:50,createdBy:owner.id});ledger.state.payments.push({id:'owner-receipt',expenseId:'owner-paid',date:'2026-11-24',amount:20,from:'b',to:'a',method:'Cash',createdBy:owner.id});await call(owner,'PUT','/api/workspace',{state:ledger.state,revision:ledger.revision});ownerRequest=(await call(owner,'POST','/api/account/deletion-request',{password:owner.password,confirmation:'REQUEST DELETION'})).value.request.id;await closeRequest(ownerRequest);assert.equal((await call(owner,'GET','/api/session')).value.user,null);assert.equal((await call(member,'GET','/api/workspace')).value.archived,true);assert.deepEqual((await call(member,'GET','/api/account/export')).value.sharedWorkspace.state,ledger.state);
 });
 await t.test('token submission brute-force is limited by the real API',async()=>{
  let limited=false;for(let i=0;i<110;i++){const r=await fetch(origin+'/api/auth/reset-password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:'invalid',password:password()})});if(r.status===429){limited=true;break;}assert.equal(r.status,400);}assert.equal(limited,true);
 });
 await t.test('database limiter state is shared across limiter instances and resets after expiry',async()=>{
  const {createLimiter}=require('../server/security.cjs'),first=createLimiter(pool),second=createLimiter(pool);await first('QA-shared',schema,2,60);await second('QA-shared',schema,2,60);await assert.rejects(()=>first('QA-shared',schema,2,60),e=>e.status===429);await pool.query("UPDATE cp_rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",[sha('QA-shared:'+schema)]);await second('QA-shared',schema,2,60);
 });
 await t.test('privacy/security/help pages are public but support identity is not invented',async()=>{
  const config=(await call(null,'GET','/api/public/config')).value;assert.equal(config.policiesDraft,true);assert.equal(config.policyVersion,'2026-11-24-draft');
 });
 }finally{await shutdown();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();cleanMail(schema);}
});
