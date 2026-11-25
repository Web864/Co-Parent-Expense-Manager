'use strict';
async function completeDeletion(q,{requestId,backupRetentionDays,reviewNote}){
 if(!/^[a-f0-9-]{36}$/.test(requestId)||!Number.isInteger(backupRetentionDays)||backupRetentionDays<0||backupRetentionDays>36500||typeof reviewNote!=='string'||reviewNote.trim().length<10||reviewNote.length>1000)throw Error('A valid request ID, reviewed retention days and a review note (10 to 1000 characters) are required.');
 // Match account request/reset lock order: account first, request second, workspace last.
 const found=await q.query('SELECT user_id FROM cp_deletion_requests WHERE id=$1',[requestId]);if(!found.rows[0])throw Error('Deletion request not found.');
 const userId=found.rows[0].user_id;const account=(await q.query('SELECT id,email FROM cp_users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
 const {rows}=await q.query('SELECT * FROM cp_deletion_requests WHERE id=$1 FOR UPDATE',[requestId]);const request=rows[0];
 if(request.legal_hold)throw Error('Request is under legal hold. Completion refused.');
 if(request.status==='completed')return {status:'completed',alreadyCompleted:true};
 // Keep original ledger IDs and financial state; no payments or expenses are deleted.
 await q.query('SELECT id FROM cp_workspaces WHERE owner_id=$1 OR member_id=$1 FOR UPDATE',[userId]);
 await q.query(`UPDATE cp_invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE workspace_id IN
 (SELECT id FROM cp_workspaces WHERE owner_id=$1 OR member_id=$1)`,[userId]);
 await q.query('UPDATE cp_workspaces SET archived_at=COALESCE(archived_at,now()),member_id=CASE WHEN member_id=$1 THEN NULL ELSE member_id END,revision=revision+1 WHERE owner_id=$1 OR member_id=$1',[userId]);
 await q.query('UPDATE cp_invitations SET invited_email=$1,revoked_at=COALESCE(revoked_at,now()) WHERE invited_email=$2',['deleted-'+userId+'@account.invalid',account.email]);
 for(const table of ['cp_sessions','cp_action_tokens','cp_profiles','cp_notification_reads'])await q.query('DELETE FROM '+table+' WHERE user_id=$1',[userId]);
 await q.query("UPDATE cp_users SET email=$1,name='Former parent',password_hash='',email_verified_at=NULL,account_status='closed' WHERE id=$2",['deleted-'+userId+'@account.invalid',userId]);
 await q.query("UPDATE cp_deletion_requests SET status='completed',completed_at=now(),backup_retention_days=$1,review_note=$2 WHERE id=$3",[backupRetentionDays,reviewNote.trim(),requestId]);
 return {status:'completed',alreadyCompleted:false};
}
module.exports={completeDeletion};
