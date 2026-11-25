'use strict';
// Removes only expired, disposable security rows. Never touches users, workspaces, ledgers or invitations.
// Schedule daily (see docs/PRODUCTION_RUNBOOK.md). Add --dry-run to count without deleting.
const {pool}=require('../server/database.cjs');
const dry=process.argv.includes('--dry-run');
const targets=[
 ['cp_sessions','expires_at<now()'],
 ['cp_rate_limits','expires_at<now()'],
 // Keep used/expired action tokens for 7 days for support investigation, then purge.
 ['cp_action_tokens',"expires_at<now()-interval '7 days'"],
];
(async()=>{
 for(const [table,where] of targets){
  const r=dry?await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`):await pool.query(`DELETE FROM ${table} WHERE ${where}`);
  console.log(JSON.stringify({table,[dry?'wouldDelete':'deleted']:dry?r.rows[0].n:r.rowCount}));
 }
})().catch(e=>{console.error('[cleanup] failed:',e.code||e.message);process.exitCode=1;}).finally(()=>pool.end());
