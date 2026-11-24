'use strict';
// Dump and restore ONLY a test source into a newly-created disposable database. No --clean or production target option exists.
const {Pool}=require('pg'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {clientArgs,runPg}=require('./backup.cjs');
const env=process.env;
const qi=value=>'"'+value.replace(/"/g,'""')+'"';
async function fingerprint(pool){const tables=(await pool.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND c.relname LIKE 'cp_%' AND n.nspname NOT LIKE 'pg_%' ORDER BY 1,2")).rows;const out=[];
 for(const t of tables){const r=await pool.query('SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),\'\')) AS digest FROM '+qi(t.nspname)+'.'+qi(t.relname)+' t');out.push({schema:t.nspname,table:t.relname,...r.rows[0]});}return out;}
(async()=>{let source,restore,created=false;const name='recovery_'+crypto.randomBytes(8).toString('hex')+'_test',directory=path.join(__dirname,'../artifacts'),dump=path.join(directory,name+'.dump');
 try{
 if(!env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL is required.');const target=new URL(env.TEST_DATABASE_URL),live=env.DATABASE_URL?new URL(env.DATABASE_URL):null;
 if(!/(_qa|_test)$/.test(target.pathname)||(live&&live.pathname===target.pathname))throw Error('Refusing application database; use a separate _qa or _test database.');
 source=new Pool({connectionString:target.toString()});fs.mkdirSync(directory,{recursive:true});const input=clientArgs(target.toString());
 const before=await fingerprint(source);runPg('pg_dump',['--format=custom','--file='+dump,'--dbname='+input.url.toString()],input.env);
 if(fs.readFileSync(dump).subarray(0,5).toString()!=='PGDMP')throw Error('Not a custom-format dump.');
 await source.query('CREATE DATABASE '+qi(name));created=true;const restoredUrl=new URL(target);restoredUrl.pathname='/'+name;const output=clientArgs(restoredUrl.toString());
 runPg('pg_restore',['--exit-on-error','--dbname='+output.url.toString(),dump],output.env);restore=new Pool({connectionString:restoredUrl.toString()});const after=await fingerprint(restore);
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Restored table counts or exact row digests differ. Keep test source idle while validating.');
 console.log(JSON.stringify({level:'info',event:'restore_validation_pass',tables:before.length,at:new Date().toISOString()}));
 }catch(e){console.error(JSON.stringify({level:'error',event:'restore_validation_failed',message:e.message}));process.exitCode=1;}
 finally{await restore?.end();if(created)await source.query('DROP DATABASE '+qi(name));await source?.end();if(fs.existsSync(dump))fs.unlinkSync(dump);}
})().catch(()=>{console.error('Recovery cleanup failed; inspect only the generated recovery_*_test database.');process.exitCode=1;});
