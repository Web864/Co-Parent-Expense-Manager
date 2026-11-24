'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function createMailer(env,root){
 const from=env.EMAIL_FROM||env.RESEND_FROM_EMAIL;
 const provider=env.EMAIL_PROVIDER||(env.RESEND_API_KEY&&from?'resend':'development');
 if(!['development','resend'].includes(provider))throw Error('EMAIL_PROVIDER must be development or resend.');
 if(env.NODE_ENV==='production'&&(provider!=='resend'||!env.RESEND_API_KEY||!from))throw Error('Production requires EMAIL_PROVIDER=resend, EMAIL_FROM and RESEND_API_KEY.');
 if(env.NODE_ENV==='production'&&env.DEV_MAIL_SINK==='true')throw Error('Development mail sink cannot be enabled in production.');
 const configured=()=>provider==='resend'?!!(env.RESEND_API_KEY&&from):env.DEV_MAIL_SINK==='true';
 async function send({to,subject,text}){
  if(!configured())throw Error('Email delivery is not configured.');
  const id=crypto.randomUUID();
  if(provider==='development'){
   const directory=path.join(root,'artifacts','mail-sink');await fs.mkdir(directory,{recursive:true});
   await fs.writeFile(path.join(directory,id+'.json'),JSON.stringify({id,to,subject,text,createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
   return;
  }
  const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[to],subject,text})});
  if(!response.ok)throw Error('Email provider rejected message.');
 }
 return {send,configured};
}
module.exports={createMailer};
