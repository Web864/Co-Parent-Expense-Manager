'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validateState,obligation}=require('../server/ledger.cjs');
test('Settings inputs have explicit associated labels and reset wording is consistent',()=>{
 const s=fs.readFileSync('src/main.ts','utf8');
 for(const id of ['profileName','profileColor','profileEmail','invitationEmail','importfile']){
  assert.ok(s.includes('for="'+id+'"'));assert.ok(s.includes('id="'+id+'"'));
 }
 assert.ok(!s.includes('Delete Profile'));assert.ok(!s.includes('Delete app profile'));
 assert.ok(s.includes("title:'Reset Display Profile',okText:'Reset Display Profile'"));
});
test('calendar normalization is rejected and exact cent allocation retained',()=>{
 const e={id:'x',date:'2026-02-30',description:'School',child:'QA',category:'Education',payer:'a',amount:10.01,shareA:50};
 assert.throws(()=>validateState({names:{a:'A',b:'B'},expenses:[e],payments:[]}),/Invalid expense/);
 assert.equal(obligation({...e,date:'2026-02-28'}),500);
});
