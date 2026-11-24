'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('original AppDeploy frontend structure and identity preserved',()=>{
 const s=read('src/main.ts');const css=read('src/styles.css');
 for(const token of ['cp-sidebar-brand','cp-welcome-heading','cp-notice-menu','cp-notice-bell','brand-mark','sidebar','noticeHeader()']){
  assert.ok((s+'\n'+css).includes(token),'Missing original design identity '+token);
 }
 assert.ok(s.includes("from './app-client'"));
 assert.ok(css.includes('CoParent Premium layout'));
});
test('P1 audit fixes and local PostgreSQL lifecycle included',()=>{
 const s=read('src/main.ts');const schema=read('server/schema.sql'),html=read('index.html');
 assert.ok(s.includes('POTENTIAL NET OFFSET'));
 assert.ok(s.includes('function pendingExpenses()'));
 assert.ok(s.includes('PostgreSQL-backed server'));
 assert.ok(s.includes('for="expenseDate"'));
 assert.ok(s.includes('for="paymentDate"'));
 assert.ok(!html.includes('href="./src/styles.css"'));
 for(const table of ['cp_users','cp_sessions','cp_workspaces','cp_profiles','cp_invitations','cp_notification_reads'])assert.ok(schema.includes(table));
});
