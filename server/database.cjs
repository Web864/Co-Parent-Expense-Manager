'use strict';
const {Pool}=require('pg'),{loadEnv}=require('./env.cjs');const env=loadEnv();
const max=Number(env.PGPOOL_MAX||10);if(!Number.isInteger(max)||max<1||max>100)throw Error('PGPOOL_MAX must be 1 to 100.');
const pool=new Pool({connectionString:env.DATABASE_URL,max,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
pool.on('error',()=>console.error(JSON.stringify({level:'error',event:'database_idle_connection_failed'})));
module.exports={pool};
