'use strict';
// Runs only against an explicitly selected, separate QA database. Never uses the app DB.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=require('pg');
const {mailToken,cleanMail}=require('./mail-helper.cjs');
process.env.EMAIL_PROVIDER='development';process.env.DEV_MAIL_SINK='true';
for(const line of (fs.existsSync(path.join(__dirname,'../.env'))?fs.readFileSync(path.join(__dirname,'../.env'),'utf8'):'').split(/\r?\n/)){
 const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const productionUrl=process.env.DATABASE_URL;
if(!process.env.TEST_DATABASE_URL)throw Error('Set TEST_DATABASE_URL to a separate empty QA database.');
const target=new URL(process.env.TEST_DATABASE_URL),source=new URL(productionUrl);
if(target.pathname===source.pathname || !/(_qa|_test)$/.test(target.pathname))throw Error('Test database must differ from application database and end in _qa or _test.');
process.env.DATABASE_URL=target.toString();process.env.PORT='0';process.env.PUBLIC_ORIGIN='http://localhost:3099';process.env.NODE_ENV='test';
const schema='qa_'+crypto.randomBytes(8).toString('hex');
process.env.PGOPTIONS='-c search_path='+schema;
const admin=new Pool({connectionString:target.toString(),options:'-c search_path=public'});
const {app,pool,start,shutdown}=require('../server/index.cjs');
let base;const origin=process.env.PUBLIC_ORIGIN;
const clone=x=>structuredClone(x);
const expense=(id,payer,amount,shareA,actor)=>({id,date:'2026-11-24',child:'QA child',description:'QA expense',category:'Education',payer,amount,shareA,createdBy:actor,createdAt:new Date().toISOString()});
const payment=(id,e,amount,actor)=>({id,expenseId:e.id,date:'2026-11-24',amount,from:e.payer==='a'?'b':'a',to:e.payer,method:'Cash',createdBy:actor});
async function call(actor,method,url,data,expected=200,requestOrigin=origin){
 const r=await fetch(base+url,{method,headers:{Origin:requestOrigin,...(actor?.cookie?{Cookie:actor.cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const value=await r.json();assert.equal(r.status,expected,JSON.stringify(value));return {value,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function signup(label){const email=label+'-'+schema+'@example.invalid',password='QA!'+crypto.randomBytes(20).toString('hex');await call(null,'POST','/api/auth/signup',{email,name:'QA '+label,password,policyAcknowledged:true,policyVersion:'2026-11-24-draft'},201);const r=await call(null,'POST','/api/auth/login',{email,password});const actor={email,id:r.value.user.userId,cookie:r.cookie};await call(actor,'POST','/api/auth/verify-email',{token:(await mailToken(email,'verify',pool))});return actor;}
async function read(actor){return (await call(actor,'GET','/api/workspace')).value;}
async function write(actor,state,expected=200,revision){const w=await read(actor);return call(actor,'PUT','/api/workspace',{state,revision:revision??w.revision},expected);}
async function add(actor,e){const w=await read(actor);w.state.expenses.push(e);await write(actor,w.state);}
async function notices(actor){return (await call(actor,'GET','/api/notifications')).value;}

test('isolated PostgreSQL API and financial release gates',async t=>{
 await admin.query('CREATE SCHEMA '+schema);await start();base='http://localhost:'+app.address().port;
 let a,b,c,invite;
 try{
 await t.test('AUTH: approved signup, unauthorized origin, weak password, session persistence',async()=>{
  await call(null,'POST','/api/auth/signup',{},403,'https://unapproved.invalid');
  await call(null,'POST','/api/auth/signup',{},403,'http://127.0.0.1:3099');
  await call(null,'POST','/api/auth/signup',{email:'qa@example.invalid',name:'QA',password:'short'},400);
  a=await signup('a');b=await signup('b');c=await signup('c');
  assert.equal((await call(a,'GET','/api/session')).value.user.userId,a.id);
  const r=await pool.query('SELECT password_hash FROM cp_users WHERE id=$1',[a.id]);assert.match(r.rows[0].password_hash,/^scrypt:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/);
 });
 await t.test('WORKSPACE: create, invite recipient isolation, accept, reject reuse and invalid',async()=>{
  await call(a,'POST','/api/workspace',{},201);await call(c,'POST','/api/workspace',{},201);
  invite=(await call(a,'POST','/api/invite',{email:b.email})).value.code;
  await call(c,'POST','/api/invite/'+invite+'/join',{},403);
  await call(b,'POST','/api/invite/'+invite+'/join',{});
  await call(b,'POST','/api/invite/'+invite+'/join',{},409);
  await call(b,'POST','/api/invite/'+'0'.repeat(64)+'/join',{},409);
  assert.equal((await read(b)).role,'member');assert.equal((await read(c)).state.expenses.length,0);
 });
 const cases=[[100,50,'a',50],[200,70,'a',60],[100,70,'b',70],[100,100,'a',0],[100,0,'a',100]];
 for(let i=0;i<cases.length;i++)await t.test('FIN-0'+(i+1)+' exact split',async()=>{
  const [amount,share,payer,owed]=cases[i],actor=payer==='a'?a:b,e=expense('fin'+i,payer,amount,share,actor.id);
  const before=await notices(actor);await add(actor,e);const after=await notices(actor);assert.equal(after.awaitingAmount-before.awaitingAmount,owed);
 });
 await t.test('FIN-06 partial, FIN-08/16 overpayment, FIN-07 full reimbursement',async()=>{
  let w=await read(a),e=w.state.expenses[0];w.state.payments.push(payment('part',e,20,a.id));await write(a,w.state);
  assert.equal((await notices(b)).pendingAmount,190);
  w=await read(a);w.state.payments.push(payment('over',e,31,a.id));await write(a,w.state,400);
  w=await read(a);w.state.payments.push(payment('full',e,30,a.id));await write(a,w.state);
  assert.equal((await notices(b)).pendingAmount,160);
 });
 await t.test('FIN-09 exact $35/$50 gross debts preserve optional $15 net',async()=>{
  const d=await signup('d'),f=await signup('f');await call(d,'POST','/api/workspace',{},201);
  const code=(await call(d,'POST','/api/invite',{email:f.email})).value.code;await call(f,'POST','/api/invite/'+code+'/join',{});
  await add(d,expense('gross-a','a',100,50,d.id));await add(f,expense('gross-b','b',50,70,f.id));
  const r=await notices(d);assert.equal(r.pendingAmount,35);assert.equal(r.awaitingAmount,50);assert.equal(r.awaitingAmount-r.pendingAmount,15);assert.equal((await read(d)).state.payments.length,0);
 });
 await t.test('FIN-10 cent allocation matches database state',async()=>{
  const e=expense('cents','a',10.01,50,a.id);await add(a,e);assert.equal((await notices(a)).awaitingAmount,165);
 });
 await t.test('FIN-11/12 and calendar/category/date validation',async()=>{
  for(const patch of [{amount:0},{amount:-1},{shareA:-1},{shareA:101},{date:'2026-02-30'},{category:''},{amount:1.001}]){
   const w=await read(a);w.state.expenses.push({...expense('invalid','a',100,50,a.id),...patch});await write(a,w.state,400);
  }
 });
 await t.test('FIN-13/14 duplicate submissions cannot create extra expenses/payments',async()=>{
  const w=await read(a);await write(a,w.state);await write(a,w.state,409,w.revision);
  const x=await read(a);x.state.expenses.push(clone(x.state.expenses[0]));await write(a,x.state,400);
  const y=await read(a);y.state.payments.push(clone(y.state.payments[0]));await write(a,y.state,400);
 });
 await t.test('FIN-15 concurrent updates: one succeeds and one conflicts',async()=>{
  const w=await read(a),x=clone(w.state),y=clone(w.state);x.expenses.push(expense('race-a','a',1,100,a.id));y.expenses.push(expense('race-b','b',1,0,b.id));
  const results=await Promise.all([fetch(base+'/api/workspace',{method:'PUT',headers:{Origin:origin,Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify({state:x,revision:w.revision})}),fetch(base+'/api/workspace',{method:'PUT',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/json'},body:JSON.stringify({state:y,revision:w.revision})})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 });
 await t.test('FIN-17/18 paid expense edits validate history and deletion is blocked',async()=>{
  let w=await read(a);w.state.expenses[0].amount=1;await write(a,w.state,400);
  w=await read(a);w.state.expenses[0].description='Updated description';await write(a,w.state);
  w=await read(a);w.state.expenses=w.state.expenses.filter(e=>e.id!==w.state.expenses[0].id);await write(a,w.state,400);
  w=await read(a);w.state.payments=[];await write(a,w.state,403);
 });
 await t.test('CRUD, ownership, unrelated workspace and backup validation',async()=>{
  const e=expense('delete-me','a',25,50,a.id);await add(a,e);
  let w=await read(b);w.state.expenses.find(x=>x.id===e.id).description='forbidden';await write(b,w.state,403);
  w=await read(a);w.state.expenses=w.state.expenses.filter(x=>x.id!==e.id);await write(a,w.state);
  assert.equal((await read(c)).state.expenses.length,0);await write(a,{expenses:[]},400);
  w=await read(a);await write(a,JSON.parse(JSON.stringify(w.state)));assert.deepEqual((await read(a)).state,w.state);
 });
 await t.test('notifications and read persistence are scoped to the account',async()=>{
  const n=await notices(b);assert.ok(n.unread>0);await call(b,'POST','/api/notifications/read',{ids:n.items.map(x=>x.id)});
  assert.equal((await notices(b)).unread,0);assert.equal((await notices(c)).items.length,0);
 });
 await t.test('profile customization and reset preserve ledger and membership',async()=>{
  const w=await read(a);await call(a,'PUT','/api/profile',{displayName:'QA custom',avatarColor:'blue'});
  assert.equal((await call(a,'GET','/api/profile')).value.displayName,'QA custom');await call(a,'DELETE','/api/profile');
  assert.equal((await call(a,'GET','/api/profile')).value.customized,false);assert.deepEqual((await read(a)).state,w.state);
 });
 await t.test('FIN-20 database and API totals reconcile in integer cents',async()=>{
  const w=await read(a),db=await pool.query('SELECT state FROM cp_workspaces WHERE owner_id=$1',[a.id]);assert.deepEqual(w.state,db.rows[0].state);
  const {summary}=require('../server/ledger.cjs');const r=await notices(a);assert.equal(r.awaitingAmount,summary(db.rows[0].state,'a').awaitingAmount);
 });
 await t.test('database custom-format backup restores exact ledger in a separate database',async()=>{
  const {spawnSync}=require('node:child_process');const backup=path.join(__dirname,'../artifacts/qa-recovery.dump');fs.mkdirSync(path.dirname(backup),{recursive:true});
  const restoreName=schema+'_test',restoreUrl=new URL(target);restoreUrl.pathname='/'+restoreName;
  const bin=process.env.PG_BIN||'';const exe=name=>bin?path.join(bin,name+(process.platform==='win32'?'.exe':'')):name;
  const r=spawnSync(exe('pg_dump'),['--format=custom','--file='+backup,'--dbname='+target.toString()],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  await admin.query('CREATE DATABASE '+restoreName);
  const restored=new Pool({connectionString:restoreUrl.toString(),options:'-c search_path='+schema});
  try{
   const result=spawnSync(exe('pg_restore'),['--exit-on-error','--dbname='+restoreUrl.toString(),backup],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
   const rows=await restored.query('SELECT state FROM cp_workspaces WHERE owner_id=$1',[a.id]);assert.deepEqual(rows.rows[0].state,(await read(a)).state);
  }finally{await restored.end();await admin.query('DROP DATABASE '+restoreName);fs.unlinkSync(backup);}
 });
 await t.test('FIN-19 fresh server process restart retains ledger and session',async()=>{
  const {spawn}=require('node:child_process');const expected=await read(a);
  for(let i=0;i<2;i++){
   const worker=spawn(process.execPath,['-e',`if(process.env.NODE_ENV==='production')global.fetch=async()=>({ok:true});const {app,start,shutdown}=require('./server/index.cjs');start().then(()=>{console.log('QA_PORT:'+app.address().port);process.stdin.once('data',()=>shutdown().then(()=>process.exit(0)));});`],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['pipe','pipe','pipe']});
   const childPort=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>{worker.kill();reject(Error('Restart worker timeout'))},10000);worker.stdout.on('data',b=>{out+=b;const m=out.match(/QA_PORT:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error('Restart worker exited '+code));});});
   const oldBase=base;base='http://localhost:'+childPort;
   try{assert.deepEqual(await read(a),expected);}finally{base=oldBase;const exit=new Promise(resolve=>worker.once('exit',resolve));worker.stdin.end('stop');await exit;}
  }
 });
 await t.test('production config uses canonical HTTPS origin, Secure cookies and HSTS',async()=>{
  const {spawn}=require('node:child_process');
  const worker=spawn(process.execPath,['-e',`if(process.env.NODE_ENV==='production')global.fetch=async()=>({ok:true});const {app,start,shutdown}=require('./server/index.cjs');start().then(()=>{console.log('QA_PORT:'+app.address().port);process.stdin.once('data',()=>shutdown().then(()=>process.exit(0)));});`],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'production',PUBLIC_ORIGIN:'https://qa.example.invalid',MIGRATE_ON_START:'false',EMAIL_PROVIDER:'resend',DEV_MAIL_SINK:'false',EMAIL_FROM:'qa@example.invalid',RESEND_API_KEY:'TEST_ONLY_NOT_A_REAL_KEY'},stdio:['pipe','pipe','pipe']});
  const childPort=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>{worker.kill();reject(Error('Production worker timeout'))},10000);worker.stdout.on('data',b=>{out+=b;const m=out.match(/QA_PORT:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});worker.on('error',reject);});
  try{
   const prodPassword=crypto.randomBytes(20).toString('hex');
   const r=await fetch('http://localhost:'+childPort+'/api/auth/signup',{method:'POST',headers:{Origin:'https://qa.example.invalid','Content-Type':'application/json','X-Forwarded-Proto':'http'},body:JSON.stringify({email:'prod-'+schema+'@example.invalid',name:'QA production',password:prodPassword,policyAcknowledged:true,policyVersion:'2026-11-24-draft'})});
   assert.equal(r.status,201);assert.equal(r.headers.get('set-cookie'),null);assert.match(r.headers.get('strict-transport-security'),/max-age=31536000/);
   const login=await fetch('http://localhost:'+childPort+'/api/auth/login',{method:'POST',headers:{Origin:'https://qa.example.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'prod-'+schema+'@example.invalid',password:prodPassword})});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
   const rejected=await fetch('http://localhost:'+childPort+'/api/auth/signup',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:'{}'});assert.equal(rejected.status,403);
  }finally{const exit=new Promise(resolve=>worker.once('exit',resolve));worker.stdin.end('stop');await exit;}
 });
 await t.test('expired invitations, membership removal and permission revocation',async()=>{
  await call(a,'POST','/api/member/remove',{});assert.equal((await read(b)).exists,false);await call(b,'GET','/api/notifications',undefined,403);
  const code=(await call(a,'POST','/api/invite',{email:b.email})).value.code;
  await pool.query("UPDATE cp_invitations SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[crypto.createHash('sha256').update(code).digest('hex')]);
  await call(b,'POST','/api/invite/'+code+'/join',{},409);
  const fresh=(await call(a,'POST','/api/invite',{email:b.email})).value.code;
  const race=await Promise.all([fetch(base+'/api/workspace',{method:'POST',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/json'},body:'{}'}),fetch(base+'/api/invite/'+fresh+'/join',{method:'POST',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/json'},body:'{}'})]);
  assert.ok(race.some(r=>r.status===409));assert.equal(race.filter(r=>r.status===200||r.status===201).length,1);
  const memberships=await pool.query('SELECT count(*)::int AS count FROM cp_workspaces WHERE owner_id=$1 OR member_id=$1',[b.id]);assert.equal(memberships.rows[0].count,1);
 });
 await t.test('session expiry, logout and password login',async()=>{
  await pool.query("UPDATE cp_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[c.id]);assert.equal((await call(c,'GET','/api/session')).value.user,null);
  await call(a,'POST','/api/auth/logout',{});assert.equal((await call(a,'GET','/api/session')).value.user,null);
  await call(null,'POST','/api/auth/login',{email:a.email,password:'wrong-password'},401);
  const password='QA-login-'+crypto.randomBytes(16).toString('hex'),mail='login-'+schema+'@example.invalid';
  const signed=await call(null,'POST','/api/auth/signup',{email:mail,name:'Login QA',password,policyAcknowledged:true,policyVersion:'2026-11-24-draft'},201);await call({cookie:signed.cookie},'POST','/api/auth/logout',{});
  assert.ok((await call(null,'POST','/api/auth/login',{email:mail,password})).cookie);
 });
 }finally{
  await shutdown();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();cleanMail(schema);
 }
});
