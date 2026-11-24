'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
for(const line of (fs.existsSync(path.join(root,'.env'))?fs.readFileSync(path.join(root,'.env'),'utf8'):'').split(/\r?\n/)){
  const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
async function main(){if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing. Copy .env.example to .env and set PostgreSQL connection.');
  const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  try{const r=await pool.query('SELECT current_database() AS database, current_user AS username, version() AS version');console.log('✓ PostgreSQL connection: OK');console.log('Database:',r.rows[0].database);console.log('Role:',r.rows[0].username);console.log('Version:',r.rows[0].version.split(' on ')[0]);
    const c=await pool.query('SELECT to_regclass($1) AS table',['public.cp_workspaces']);console.log('Schema:',c.rows[0].table?'present':'will be created automatically at server startup');
  }finally{await pool.end();}}
main().catch(e=>{console.error('✗ PostgreSQL connection failed:',e.message);process.exitCode=1;});
