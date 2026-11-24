'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {obligation,validateState,checkMutation,summary}=require('../server/ledger.cjs');
const item=(id,payer,amount,shareA,createdBy)=>({id,date:'2026-11-24',child:'School',description:'Stationery',category:'Education',payer,amount,shareA,createdBy,createdAt:'2026-11-24T08:00:00.000Z'});
const payment=(id,expenseId,amount,from,to,createdBy)=>({id,expenseId,date:'2026-11-24',amount,from,to,method:'Cash',createdBy});
const ledger=(expenses=[],payments=[])=>({expenses,payments,names:{a:'Parent A',b:'Parent B'}});
test('50/50 and 70/30 reimbursements, round in cents',()=>{
 assert.equal(obligation(item('x','a',100,50,'a')),5000);
 assert.equal(obligation(item('x','a',200,70,'a')),6000);
 assert.equal(obligation(item('x','b',200,70,'b')),14000);
 assert.equal(obligation(item('x','a',10.01,50,'a')),500);
});
test('equal gross obligations are still outstanding even when net offset zero',()=>{
 const s=ledger([item('a','a',256,50,'a'),item('b','b',256,50,'b')]);
 validateState(s);const a=summary(s,'a'),b=summary(s,'b');
 assert.equal(a.pendingAmount,128);assert.equal(a.awaitingAmount,128);
 assert.equal(b.pendingAmount,128);assert.equal(b.awaitingAmount,128);
});
test('partial payment reduces pending and overpayment fails validation',()=>{
 const e=item('a','a',100,50,'a'),p=payment('p','a',20,'b','a','a');const s=ledger([e],[p]);
 assert.ok(validateState(s));assert.equal(summary(s,'b').pendingAmount,30);
 assert.throws(()=>validateState(ledger([e],[p,payment('q','a',31,'b','a','a')])),/exceed/);
});
test('owner and member only add expenses using own payer role',()=>{
 const base=ledger(),a=item('a','a',100,50,'owner'),b=item('b','b',40,50,'member');
 assert.doesNotThrow(()=>checkMutation(base,ledger([a]),'owner','owner','owner'));
 assert.doesNotThrow(()=>checkMutation(base,ledger([b]),'member','owner','member'));
 assert.throws(()=>checkMutation(base,ledger([a]),'member','owner','member'),/signed-in/);
 assert.throws(()=>checkMutation(ledger([a]),ledger([b]),'member','owner','member'),/Cannot delete/);
});
test('immutable payments, audit metadata and previously paid expenses protected',()=>{
 const e=item('a','a',100,50,'owner'),p=payment('p','a',20,'b','a','owner');
 const original=ledger([e],[p]);validateState(original);
 assert.throws(()=>checkMutation(original,ledger([e],[]),'owner','owner','owner'),/cannot be changed/);
 assert.throws(()=>checkMutation(original,ledger([],[p]),'owner','owner','owner'),/Cannot delete/);
 const modified={...e,createdAt:'2026-11-24T09:00:00.000Z'};
 assert.throws(()=>checkMutation(original,ledger([modified],[p]),'owner','owner','owner'),/edit your own/);
});
test('invalid dates, duplicate ids and malformed percentages rejected',()=>{
 const e=item('a','a',120,50,'owner');
 assert.throws(()=>validateState(ledger([e,e])),/Invalid expense/);
 assert.throws(()=>validateState(ledger([{...e,shareA:120}])),/Invalid expense/);
 assert.throws(()=>validateState(ledger([{...e,date:'not-a-date'}])),/Invalid expense/);
});
