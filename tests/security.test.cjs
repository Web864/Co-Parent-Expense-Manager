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
