'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{loadEnv}=require('../server/env.cjs');
const env=loadEnv();
function clientArgs(connection){const url=new URL(connection);const childEnv={...env,PGPASSWORD:decodeURIComponent(url.password)};url.password='';return {url,env:childEnv};}
function runPg(name,args,childEnv){const executable=env.PG_BIN?path.join(env.PG_BIN,name+(process.platform==='win32'?'.exe':'')):name;const r=spawnSync(executable,args,{env:childEnv,encoding:'utf8'});if(r.error||r.status!==0)throw Error(name+' failed. Check tool availability, connection and permissions (details redacted).');}
module.exports={clientArgs,runPg};
if(require.main===module){
 try{
 if(!env.DATABASE_URL)throw Error('DATABASE_URL is not configured.');const dir=path.join(__dirname,'../backups');fs.mkdirSync(dir,{recursive:true});
 const output=path.join(dir,'coparent-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex')+'.dump');const connection=clientArgs(env.DATABASE_URL);
 runPg('pg_dump',['--format=custom','--file='+output,'--dbname='+connection.url.toString()],connection.env);
 if(fs.readFileSync(output).subarray(0,5).toString()!=='PGDMP')throw Error('Backup has invalid format.');
 console.log(JSON.stringify({level:'info',event:'backup_success',file:path.basename(output),bytes:fs.statSync(output).size,at:new Date().toISOString()}));
 }catch(e){console.error(JSON.stringify({level:'error',event:'backup_failed',message:e.message,at:new Date().toISOString()}));process.exitCode=1;}
}
