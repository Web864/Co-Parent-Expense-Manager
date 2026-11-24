'use strict';
// Adapts the exact AppDeploy financial state shape to PostgreSQL.
const MAX_EXPENSES=500,MAX_PAYMENTS=1000;
const string=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
function error(status,message){const e=new Error(message);e.status=status;throw e;}
function cents(n){return Math.round(n*100);}
function obligation(expense){const total=cents(expense.amount);const a=Math.round(total*Math.round(expense.shareA*100)/10000);return expense.payer==='a'?total-a:a;}
function validDate(v){return typeof v==='string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function validateState(s){
  if(!s||typeof s!=='object'||!Array.isArray(s.expenses)||!Array.isArray(s.payments)||!s.names||
    !string(s.names.a,35)||!string(s.names.b,35)||s.expenses.length>MAX_EXPENSES||s.payments.length>MAX_PAYMENTS)error(400,'Invalid ledger structure.');
  const expenses=new Map(),paid=new Map(),payments=new Set();
  for(const e of s.expenses){
    if(!e||!string(e.id,80)||expenses.has(e.id)||!validDate(e.date)||
       !string(e.child,80)||!string(e.description,100)||!string(e.category,40)||!['a','b'].includes(e.payer)||
       !Number.isFinite(e.amount)||e.amount<=0||e.amount>1000000||Math.abs(cents(e.amount)-e.amount*100)>.001||
       !Number.isFinite(e.shareA)||e.shareA<0||e.shareA>100||Math.abs(Math.round(e.shareA*100)-e.shareA*100)>.000001||(e.createdBy!==undefined&&!string(e.createdBy,128))||
       (e.createdAt!==undefined&&(typeof e.createdAt!=='string'||!Number.isFinite(Date.parse(e.createdAt)))))error(400,'Invalid expense data.');
    expenses.set(e.id,e);paid.set(e.id,0);
  }
  for(const p of s.payments){
    const e=expenses.get(p?.expenseId);
    if(!p||!e||!string(p.id,80)||payments.has(p.id)||!validDate(p.date)||!string(p.method,60)||!Number.isFinite(p.amount)||p.amount<=0||
       Math.abs(cents(p.amount)-p.amount*100)>.001||(p.createdBy!==undefined&&!string(p.createdBy,128))||
       p.from!==(e.payer==='a'?'b':'a')||p.to!==e.payer)error(400,'Invalid reimbursement data.');
    payments.add(p.id);paid.set(p.expenseId,paid.get(p.expenseId)+cents(p.amount));
    if(paid.get(p.expenseId)>obligation(e))error(400,'Reimbursements cannot exceed the amount owed.');
  }
  return true;
}
function checkMutation(before,after,actor,owner,role){
  if(role!=='owner'&&JSON.stringify(before.names)!==JSON.stringify(after.names))error(403,'Only the owner can edit workspace names.');
  const oldExpenses=new Map(before.expenses.map(x=>[x.id,x]));
  const newExpenses=new Map(after.expenses.map(x=>[x.id,x]));
  const oldPays=new Map(before.payments.map(x=>[x.id,x]));
  const newPays=new Map(after.payments.map(x=>[x.id,x]));
  const mine=x=>(x.createdBy||owner)===actor;
  for(const x of before.expenses){
    const n=newExpenses.get(x.id);
    if(!n){if(!mine(x)||before.payments.some(p=>p.expenseId===x.id))error(403,'Cannot delete another parent expense or one with recorded reimbursements.');continue;}
    if(JSON.stringify(x)!==JSON.stringify(n)&&(!mine(x)||n.payer!==x.payer||n.createdBy!==x.createdBy||n.createdAt!==x.createdAt))error(403,'You may only edit your own expense.');
  }
  for(const x of after.expenses)if(!oldExpenses.has(x.id)&&(x.createdBy!==actor||x.payer!==(role==='owner'?'a':'b')))error(403,'New expenses must belong to the signed-in parent.');
  for(const p of before.payments){const next=newPays.get(p.id);if(!next||JSON.stringify(next)!==JSON.stringify(p))error(403,'Recorded reimbursements cannot be changed or removed.');}
  for(const p of after.payments){if(oldPays.has(p.id))continue;const e=newExpenses.get(p.expenseId);
    if(!e||!mine(e)||p.createdBy!==actor)error(403,'Only the owner of the paid expense may record its reimbursement.');}
  // Payment history is immutable; expense edits still cannot invalidate existing payouts.
}
function summary(state,own){
  let pending=0,pendingCents=0,awaiting=0,awaitingCents=0;
  for(const e of state.expenses){const paid=state.payments.filter(p=>p.expenseId===e.id).reduce((n,p)=>n+cents(p.amount),0);
    const left=Math.max(0,obligation(e)-paid);if(!left)continue;
    if(e.payer===own){awaiting++;awaitingCents+=left;}else{pending++;pendingCents+=left;}}
  return {pending,pendingAmount:pendingCents/100,awaiting,awaitingAmount:awaitingCents/100};
}
module.exports={validateState,checkMutation,summary,obligation,error,cents};
