 'use strict';
const fs=require('node:fs'),path=require('node:path'),{sha}=require('../server/security.cjs');
const directory=path.join(__dirname,'../artifacts/mail-sink');
async function mailToken(email,kind,pool){
 const r=await pool.query('SELECT t.token_hash FROM cp_action_tokens t JOIN cp_users u ON u.id=t.user_id WHERE u.email=$1 AND t.kind=$2 ORDER BY t.created_at DESC LIMIT 1',[email,kind]);const expected=r.rows[0]?.token_hash;
 for(let i=0;i<250;i++){
  if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json'))){let m;try{m=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));}catch{continue;}
   const token=m.to===email&&m.text.includes('/account/'+kind+'?token=')?m.text.match(/token=([a-f0-9]{64})/)?.[1]:null;if(token&&sha(token)===expected)return token;
  }
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('Expected test message was not delivered to the private mail sink.');
}
function cleanMail(schema){if(fs.existsSync(directory))for(const name of fs.readdirSync(directory)){const file=path.join(directory,name);if(name.endsWith('.json')){const m=JSON.parse(fs.readFileSync(file,'utf8'));if(m.to.includes(schema))fs.unlinkSync(file);}}}
module.exports={mailToken,cleanMail};
