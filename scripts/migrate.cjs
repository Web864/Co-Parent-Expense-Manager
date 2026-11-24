'use strict';
const fs=require('node:fs'),path=require('node:path');
const {pool}=require('../server/database.cjs');
(async()=>{const q=await pool.connect();try{await q.query('BEGIN');await q.query("SELECT pg_advisory_xact_lock(724631864)");await q.query(fs.readFileSync(path.join(__dirname,'../server/schema.sql'),'utf8'));await q.query('COMMIT');console.log('Additive schema migration applied. Existing accounts retain legacy access; no financial records reset.');}catch(e){await q.query('ROLLBACK');console.error('Migration rolled back.',{code:e.code||'INTERNAL'});process.exitCode=1;}finally{q.release();await pool.end();}})();
