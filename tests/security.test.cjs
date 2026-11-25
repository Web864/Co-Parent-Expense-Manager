'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {hashPassword,passwordMatches,passwordValid}=require('../server/security.cjs'),{createMailer}=require('../server/mail.cjs');
test('async scrypt verifies legacy sync hashes and uses unique salts',async()=>{
 const password=crypto.randomBytes(20).toString('hex'),salt=crypto.randomBytes(16).toString('hex'),legacy=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
 assert.equal(await passwordMatches(password,legacy),true);assert.equal(await passwordMatches(password+'wrong',legacy),false);assert.equal(await passwordMatches(password,null),false);assert.notEqual(await hashPassword(password),await hashPassword(password));
});
test('password policy bounds and malformed hashes fail safely',async()=>{assert.equal(passwordValid('a'.repeat(9)),false);assert.equal(passwordValid('a'.repeat(10)),true);assert.equal(passwordValid('a'.repeat(128)),true);assert.equal(passwordValid('a'.repeat(129)),false);assert.equal(await passwordMatches('not-a-secret','malformed'),false);});
test('production rejects development sinks and incomplete email configuration',()=>{
 assert.throws(()=>createMailer({NODE_ENV:'production',EMAIL_PROVIDER:'development'},'.'),/Production requires/);
 assert.throws(()=>createMailer({NODE_ENV:'production',EMAIL_PROVIDER:'resend',EMAIL_FROM:'qa@example.invalid',RESEND_API_KEY:'TEST_ONLY',DEV_MAIL_SINK:'true'},'.'),/cannot be enabled/);
 assert.equal(createMailer({EMAIL_PROVIDER:'development'},'.').configured(),false);
});

test('Resend adapter sends server-side credentials, timeout and idempotency header without exposing provider errors',async()=>{
 const saved=global.fetch;let request;
 try{global.fetch=async(url,options)=>{request={url,options};return {ok:true};};const mailer=createMailer({EMAIL_PROVIDER:'resend',EMAIL_FROM:'qa@example.invalid',RESEND_API_KEY:'TEST_ONLY'},'.');await mailer.send({to:'recipient@example.invalid',subject:'QA',text:'QA message'});assert.equal(request.url,'https://api.resend.com/emails');assert.equal(JSON.parse(request.options.body).from,'qa@example.invalid');assert.match(request.options.headers['Idempotency-Key'],/^[a-f0-9-]{36}$/);assert.equal(request.options.headers.Authorization,'Bearer TEST_ONLY');assert.ok(request.options.signal);global.fetch=async()=>({ok:false});await assert.rejects(()=>mailer.send({to:'recipient@example.invalid',subject:'QA',text:'QA'}),/provider rejected/);}finally{global.fetch=saved;}
});

test('mail failures expose only safe status/reason and never key, recipient or link',async()=>{
 const {logMailFailure}=require('../server/mail.cjs');
 const saved=global.fetch,savedErr=console.error;let logged='';
 const env={EMAIL_PROVIDER:'resend',EMAIL_FROM:'CoParent <qa@example.invalid>',RESEND_API_KEY:'re_SECRET_TEST_KEY'};
 try{
  global.fetch=async()=>({ok:false,status:403,json:async()=>({name:'validation_error',message:'domain not verified for recipient@example.invalid'})});
  const mailer=createMailer(env,'.');assert.equal(mailer.mode,'resend');
  await assert.rejects(()=>mailer.send({to:'recipient@example.invalid',subject:'S',text:'https://x/#/account/reset?token=SECRET'}),e=>{
   assert.equal(e.httpStatus,403);assert.equal(e.reason,'validation_error');
   console.error=(m)=>{logged+=m;};logMailFailure('reset',e);console.error=savedErr;return true;});
  assert.ok(logged.includes('validation_error')&&logged.includes('403'));
  for(const secret of ['re_SECRET_TEST_KEY','recipient@example.invalid','SECRET','domain not verified'])assert.ok(!logged.includes(secret),'log leaked '+secret);
  global.fetch=async()=>{const e=Error('x');e.name='TimeoutError';throw e;};
  await assert.rejects(()=>mailer.send({to:'a@example.invalid',subject:'S',text:'T'}),e=>e.reason==='timeout'&&e.provider==='resend');
  global.fetch=async()=>({ok:false,status:500,json:async()=>{throw Error('not json');}});
  await assert.rejects(()=>mailer.send({to:'a@example.invalid',subject:'S',text:'T'}),e=>e.httpStatus===500&&e.reason==='unknown');
 }finally{global.fetch=saved;console.error=savedErr;}
});

test('production rejects placeholder or malformed sender addresses',()=>{
 const base={NODE_ENV:'production',EMAIL_PROVIDER:'resend',RESEND_API_KEY:'TEST_ONLY'};
 assert.throws(()=>createMailer({...base,EMAIL_FROM:'noreply@example.com'},'.'),/placeholder domain/);
 assert.throws(()=>createMailer({...base,EMAIL_FROM:'CoParent <noreply@example.org>'},'.'),/placeholder domain/);
 assert.throws(()=>createMailer({...base,EMAIL_FROM:'not-an-address'},'.'),/EMAIL_FROM must be/);
 assert.equal(createMailer({...base,EMAIL_FROM:'CoParent <noreply@mail.realdomain.test>'},'.').configured(),true);
 assert.equal(createMailer({EMAIL_PROVIDER:'development',DEV_MAIL_SINK:'true'},'.').mode,'development');
});

test('account email retries only transient failures, reuses one idempotency key, and logs without secrets',async()=>{
 const {sendWithRetry}=require('../server/mail.cjs');
 const saved=global.fetch,savedErr=console.error;let logs=[];const keys=[];
 const mailer=createMailer({EMAIL_PROVIDER:'resend',EMAIL_FROM:'CoParent <qa@example.invalid>',RESEND_API_KEY:'re_SECRET_TEST_KEY'},'.');
 const message={to:'recipient@example.invalid',subject:'S',text:'https://x/#/account/reset?token=SECRET'};
 const fast={kind:'reset',sleep:async()=>{}};
 const respond=(...statuses)=>{let i=0;global.fetch=async(url,init)=>{keys.push(init.headers['Idempotency-Key']);const status=statuses[Math.min(i++,statuses.length-1)];return status===200?{ok:true,status}:{ok:false,status,json:async()=>({name:status===503?'application_error':'validation_error'})};};};
 console.error=m=>logs.push(m);
 try{
  respond(503,200);await sendWithRetry(mailer,message,fast);
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1],'idempotency key must be reused');
  keys.length=0;logs=[];respond(403);await assert.rejects(()=>sendWithRetry(mailer,message,fast),e=>e.httpStatus===403);
  assert.equal(keys.length,1,'4xx must not be retried');
  keys.length=0;logs=[];respond(500);await assert.rejects(()=>sendWithRetry(mailer,message,fast),e=>e.httpStatus===500);
  assert.equal(keys.length,3,'3 attempts total');assert.ok(logs.some(l=>l.includes('"willRetry":false')&&l.includes('"attempt":3')));
  for(const l of logs)for(const secret of ['re_SECRET_TEST_KEY','recipient@example.invalid','SECRET'])assert.ok(!l.includes(secret),'log leaked '+secret);
 }finally{global.fetch=saved;console.error=savedErr;}
});
