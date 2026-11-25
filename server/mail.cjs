'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function createMailer(env,root){
 const from=env.EMAIL_FROM||env.RESEND_FROM_EMAIL;
 const provider=env.EMAIL_PROVIDER||(env.RESEND_API_KEY&&from?'resend':'development');
 if(!['development','resend'].includes(provider))throw Error('EMAIL_PROVIDER must be development or resend.');
 if(env.NODE_ENV==='production'&&(provider!=='resend'||!env.RESEND_API_KEY||!from))throw Error('Production requires EMAIL_PROVIDER=resend, EMAIL_FROM and RESEND_API_KEY.');
 if(env.NODE_ENV==='production'&&env.DEV_MAIL_SINK==='true')throw Error('Development mail sink cannot be enabled in production.');
 if(env.NODE_ENV==='production'){
  const address=(from.match(/<([^<>]+)>\s*$/)||[null,from])[1].trim(),domain=address.split('@')[1]||'';
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))throw Error('EMAIL_FROM must be an email address or "Name <address>".');
  // Placeholder domains from .env.example can never be Resend-verified; fail fast instead of failing silently per email.
  if(['example.com','example.org','example.net'].includes(domain.toLowerCase()))throw Error('EMAIL_FROM still uses a placeholder domain. Use a sender on your Resend-verified domain.');
 }
 const configured=()=>provider==='resend'?!!(env.RESEND_API_KEY&&from):env.DEV_MAIL_SINK==='true';
 async function send({to,subject,text}){
  if(!configured())throw Error('Email delivery is not configured.');
  const id=crypto.randomUUID();
  if(provider==='development'){
   const directory=path.join(root,'artifacts','mail-sink');await fs.mkdir(directory,{recursive:true});
   await fs.writeFile(path.join(directory,id+'.json'),JSON.stringify({id,to,subject,text,createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
   return;
  }
  let response;
  try{response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[to],subject,text})});}
  catch(cause){const e=Error('Email provider unreachable.');e.provider='resend';e.reason=cause&&cause.name==='TimeoutError'?'timeout':'network';throw e;}
  if(!response.ok){
   // Only the HTTP status and Resend's short error name are kept (e.g. validation_error, invalid_api_key). Never the body text, key, recipient or link.
   let name='unknown';try{const data=await response.json();if(data&&typeof data.name==='string')name=data.name.replace(/[^a-z0-9_]/gi,'').slice(0,60)||'unknown';}catch{}
   const e=Error('Email provider rejected message.');e.provider='resend';e.httpStatus=response.status;e.reason=name;throw e;
  }
  // A 2xx from Resend means "accepted for sending", not "delivered to the inbox".
 }
 return {send,configured,mode:provider};
}
// Safe, secret-free diagnostics for operators.
function logMailFailure(kind,e){console.error(JSON.stringify({level:'error',event:'mail_delivery_failed',kind,provider:e&&e.provider||'unknown',httpStatus:e&&e.httpStatus||null,reason:e&&e.reason||(e&&e.message)||'unknown'}));}
module.exports={createMailer,logMailFailure};
