'use strict';
const {pool}=require('../server/database.cjs'),{completeDeletion}=require('../server/deletion.cjs');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
(async()=>{let q;try{
 if(!args.includes('--retention-reviewed')||!args.includes('--request-id')||!args.includes('--backup-retention-days')||!args.includes('--review-note'))throw Error('Usage: --request-id UUID --retention-reviewed --backup-retention-days APPROVED_DAYS --review-note "Reviewed shared records and legal holds". This completes an existing user request; it never erases ledger history.');
 q=await pool.connect();await q.query('BEGIN');const result=await completeDeletion(q,{requestId:value('--request-id'),backupRetentionDays:Number(value('--backup-retention-days')),reviewNote:value('--review-note')});await q.query('COMMIT');console.log('Deletion completion:',result.status,result.alreadyCompleted?'(already completed)':'(sessions revoked, account anonymized, ledger archived)');
 }catch(e){if(q)await q.query('ROLLBACK');console.error('Deletion completion refused:',e.message);process.exitCode=1;}finally{q?.release();await pool.end();}})();
