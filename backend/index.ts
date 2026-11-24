import {router,json,error,requireAuth,db,invites,isInviteError,isAppDatabaseError,secrets} from '@appdeploy/sdk';
type Parent='a'|'b';
type Expense={id:string;date:string;child:string;description:string;category:string;payer:Parent;amount:number;shareA:number;createdBy?:string;createdAt?:string};
type Payment={id:string;expenseId:string;date:string;amount:number;from:Parent;to:Parent;method:string;createdBy?:string};
type Data={expenses:Expense[];payments:Payment[];names:{a:string;b:string}};
type Membership={workspaceId:string;role:'owner'|'member'};
type Workspace={owner:string;member:string|null;revision:number;state:Data};
const WORK='cp_workspaces_v1',MEM='cp_memberships_v1';
const text=(x:unknown,n:number)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
function valid(value:unknown):value is Data{
 if(!value||typeof value!=='object')return false;const s=value as Data;
 if(!Array.isArray(s.expenses)||!Array.isArray(s.payments)||s.expenses.length>500||s.payments.length>1000||!s.names||!text(s.names.a,35)||!text(s.names.b,35))return false;
 const amounts=new Map<string,{owed:number;paid:number;from:Parent;to:Parent}>(),ids=new Set<string>();
 for(const e of s.expenses){
  if(!e||!text(e.id,80)||amounts.has(e.id)||!text(e.date,10)||!text(e.child,80)||!text(e.description,100)||!text(e.category,40)||(e.createdBy!==undefined&&!text(e.createdBy,128))||(e.createdAt!==undefined&&(typeof e.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(e.createdAt)||!Number.isFinite(Date.parse(e.createdAt))))||!['a','b'].includes(e.payer)||!Number.isFinite(e.amount)||e.amount<=0||e.amount>1000000||!Number.isFinite(e.shareA)||e.shareA<0||e.shareA>100)return false;
  const cents=Math.round(e.amount*100),share=Math.round(cents*e.shareA/100);
  if(Math.abs(cents-e.amount*100)>.001)return false;
  amounts.set(e.id,{owed:(e.payer==='a'?cents-share:share)/100,paid:0,from:e.payer==='a'?'b':'a',to:e.payer});
 }
 for(const p of s.payments){
  if(!p||!text(p.id,80)||ids.has(p.id)||!text(p.date,10)||!text(p.method,60)||(p.createdBy!==undefined&&!text(p.createdBy,128))||!Number.isFinite(p.amount)||p.amount<=0||Math.abs(Math.round(p.amount*100)-p.amount*100)>.001)return false;
  ids.add(p.id);const o=amounts.get(p.expenseId);if(!o||o.from!==p.from||o.to!==p.to)return false;
  o.paid=Math.round((o.paid+p.amount)*100)/100;if(o.paid>o.owed+.001)return false;
 }
 return true;
}

function canModifyState(before:Data,after:Data,actorId:string,ownerId:string,role:'owner'|'member'){
  if(role!=='owner'&&JSON.stringify(before.names)!==JSON.stringify(after.names))return false;
  const owns=(item:{createdBy?:string})=>(item.createdBy||ownerId)===actorId;
  const oldExpenses=new Map(before.expenses.map(e=>[e.id,e]));
  const newExpenses=new Map(after.expenses.map(e=>[e.id,e]));
  const oldPayments=new Map(before.payments.map(p=>[p.id,p]));
  const newPayments=new Map(after.payments.map(p=>[p.id,p]));
  for(const e of before.expenses){
    const next=newExpenses.get(e.id);
    if(!next){ if(!owns(e))return false; continue; }
    if(JSON.stringify(e)!==JSON.stringify(next)){
      if(!owns(e)||next.createdBy!==e.createdBy||next.payer!==e.payer)return false;
    }
  }
  for(const e of after.expenses){
    if(oldExpenses.has(e.id))continue;
    if(e.createdBy!==actorId||e.payer!==(role==='owner'?'a':'b'))return false;
  }
  for(const p of before.payments){
    const next=newPayments.get(p.id);
    if(!next){return false;}
    if(JSON.stringify(p)!==JSON.stringify(next))return false;
  }
  for(const p of after.payments){
    if(oldPayments.has(p.id))continue;
    const e=newExpenses.get(p.expenseId);
    if(!e||!owns(e)||p.createdBy!==actorId)return false;
  }
  return true;
}

async function getWorkspace(userId:string){
 const [m]=await db.get<Membership>(MEM,[userId],{consistent:true});if(!m)return null;
 const [w]=await db.get<Workspace>(WORK,[m.workspaceId],{consistent:true});
 if(!w||(m.role==='owner'?w.owner!==userId:w.member!==userId))return null;
 return {m,w,id:m.workspaceId};
}
const dbConflict=(e:unknown)=>isAppDatabaseError(e)&&['AppDatabaseConflict','AppDatabaseConditionFailed','AppDatabaseDuplicateId'].includes(e.code);
const inviteError=(e:unknown)=>{if(isInviteError(e))return error(e.code,400);throw e;};
export const handler=router({
 'GET /api/notifications':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  const uid=c.user!.userId;
  const [pref]=await db.get<{read?:string[]}>('cp_notification_reads_v1',[uid],{consistent:true});
  const read=new Set(Array.isArray(pref?.read)?pref.read:[]);
  const expenses=o.w.state.expenses;
  const activities=expenses.filter(e=>(e.createdBy||o.w.owner)!==uid&&e.createdAt&&Number.isFinite(Date.parse(e.createdAt)))
    .sort((x,y)=>Date.parse(y.createdAt||'')-Date.parse(x.createdAt||'')).slice(0,30)
    .map(e=>({id:e.id,description:e.description,amount:e.amount,parent:e.payer,createdAt:e.createdAt,read:read.has(e.id)}));
  const own=o.m.role==='owner'?'a':'b';
  let pending=0,pendingCents=0,awaiting=0,awaitingCents=0;
  for(const e of expenses){
    const cents=Math.round(e.amount*100),a=Math.round(cents*e.shareA/100);
    const owed=e.payer==='a'?cents-a:a;
    const paid=o.w.state.payments.filter(p=>p.expenseId===e.id).reduce((sum,p)=>sum+Math.round(p.amount*100),0);
    const remaining=Math.max(0,owed-paid);
    if(!remaining)continue;
    if(e.payer===own){awaiting++;awaitingCents+=remaining;}
    else{pending++;pendingCents+=remaining;}
  }
  return json({items:activities,unread:activities.filter(x=>!x.read).length,
    pending,pendingAmount:pendingCents/100,awaiting,awaitingAmount:awaitingCents/100,revision:o.w.revision});
 }],
 'POST /api/notifications/read':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  const body=c.body as {ids?:unknown};
  if(!Array.isArray(body?.ids)||body.ids.length>40||!body.ids.every(x=>typeof x==='string'&&x.length<=80))
    return error('Invalid notification selection',400);
  const allowed=new Set(o.w.state.expenses.filter(e=>(e.createdBy||o.w.owner)!==c.user!.userId).map(e=>e.id));
  const uid=c.user!.userId;
  const [pref]=await db.get<{read?:string[]}>('cp_notification_reads_v1',[uid],{consistent:true});
  const seen=Array.from(new Set([...(pref?.read||[]),...body.ids.filter((x:string)=>allowed.has(x))])).slice(-200);
  try {
    if(pref){
      const [ok]=await db.tx.update('cp_notification_reads_v1',[{id:uid,record:{read:seen}}],{patch:true});
      if(!ok)return error('Retry updating notifications',409);
    }else{
      const [id]=await db.tx.add('cp_notification_reads_v1',[{id:uid,read:seen}]);
      if(!id)return error('Retry updating notifications',409);
    }
    return json({updated:true});
  }catch(e){if(dbConflict(e))return error('Retry updating notifications',409);throw e;}
 }],
 'GET /api/profile':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  const [saved]=await db.get<{displayName:string;avatarColor:string}>('cp_profiles_v1',[c.user!.userId],{consistent:true});
  return json({displayName:saved?.displayName||c.user!.name||'',
    avatarColor:saved?.avatarColor||'teal',email:c.user!.email||'',role:o.m.role,customized:!!saved});
 }],
 'PUT /api/profile':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  const body=c.body as {displayName?:unknown;avatarColor?:unknown};
  const displayName=typeof body?.displayName==='string'?body.displayName.trim():'';
  const avatarColor=body?.avatarColor;
  if(!text(displayName,50)||!['teal','blue','violet','coral'].includes(String(avatarColor)))return error('Invalid profile details',400);
  const id=c.user!.userId;
  const [existing]=await db.get('cp_profiles_v1',[id],{consistent:true});
  try {
    if(existing){
      const [ok]=await db.tx.update('cp_profiles_v1',[{id,record:{displayName,avatarColor}}],{patch:true});
      if(!ok)return error('Profile changed. Please retry.',409);
    }else{
      const [added]=await db.add('cp_profiles_v1',[{id,displayName,avatarColor}]);
      if(!added)return error('Profile changed. Please retry.',409);
    }
    return json({saved:true,displayName,avatarColor});
  }catch(e){if(dbConflict(e))return error('Profile change conflict. Retry.',409);throw e;}
 }],
 'DELETE /api/profile':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  await db.delete('cp_profiles_v1',[c.user!.userId]);
  return json({deleted:true,note:'App profile customization removed. Sign-in account, workspace, and expense records retained.'});
 }],

 'GET /api/workspace':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return json({exists:false});
  const ids=[o.w.owner,...(o.w.member?[o.w.member]:[])];
  const records=await db.get<{displayName:string}>('cp_profiles_v1',ids,{consistent:true});
  const profileNames={
    a:records[0]?.displayName||((c.user!.userId===o.w.owner)?c.user!.name:'')||'Parent A',
    b:(o.w.member?records[1]?.displayName||((c.user!.userId===o.w.member)?c.user!.name:''):'')||'Parent B'
  };
  return json({exists:true,state:o.w.state,revision:o.w.revision,role:o.m.role,shared:!!o.w.member,profileNames});
}],
 'POST /api/workspace':[requireAuth(),async c=>{
  const uid=c.user!.userId;if(await getWorkspace(uid))return error('Already has workspace',409);
  const workspaceId='cp_'+uid.replace(/[^a-zA-Z0-9_-]/g,'');
  try{
   await db.transact([
    db.tx.add(WORK,[{id:workspaceId,owner:uid,member:null,revision:0,state:{expenses:[],payments:[],names:{a:'Parent A',b:'Parent B'}}}]),
    db.tx.add(MEM,[{id:uid,workspaceId,role:'owner'}])
   ]);
   return json({created:true});
  }catch(e){if(dbConflict(e))return error('Workspace creation conflict',409);throw e;}
 }],
 'PUT /api/workspace':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);if(!o)return error('No workspace access',403);
  const body=c.body as {state?:unknown;revision?:unknown};
  if(!body||!Number.isInteger(body.revision)||!valid(body.state))return error('Invalid expense data',400);
  if(!canModifyState(o.w.state,body.state,c.user!.userId,o.w.owner,o.m.role))return error('You can only change expenses and payments you created',403);
  const rev=body.revision as number;if(rev!==o.w.revision)return error('Changes from other parent detected. Reload.',409);
  try{
   const [ok]=await db.tx.update(WORK,[{id:o.id,record:{state:body.state,revision:rev+1},if:{revision:rev}}],{patch:true});
   return ok?json({revision:rev+1}):error('Conflicting change. Reload.',409);
  }catch(e){if(dbConflict(e))return error('Conflicting change. Reload.',409);throw e;}
 }],
 'POST /api/invite':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);if(!o||o.m.role!=='owner')return error('Only owner can invite',403);
  if(o.w.member)return error('Co-parent already joined',409);
  const email=String((c.body as {email?:string})?.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>150)return error('Invalid email',400);
  try{const r=await invites.create({resourceType:'coparent_workspace',authMode:'required',actor:c.user!,allowList:[email],expiresInSec:604800,context:{workspaceId:o.id}});return json({code:r.code});}catch(e){return inviteError(e);}
 }],
 'GET /api/invite/:code':[async c=>{try{const r=await invites.resolve({code:c.params.code});return json({status:r.status,expiresAt:r.expiresAt});}catch(e){return inviteError(e);}}],
 'POST /api/invite/:code/join':[requireAuth(),async c=>{
  const uid=c.user!.userId;if(await getWorkspace(uid))return error('Account already has a workspace',409);
  try{
   const r=await invites.join({code:c.params.code,actor:c.user!});
   if(r.resourceType!=='coparent_workspace'||typeof r.context?.workspaceId!=='string')return error('Invalid invite',400);
   const wid=r.context.workspaceId as string;
   const [w]=await db.get<Workspace>(WORK,[wid],{consistent:true});
   if(!w||w.member||w.owner===uid)return error('Workspace unavailable',409);
   try{
    await db.transact([
     db.tx.add(MEM,[{id:uid,workspaceId:wid,role:'member'}]),
     db.tx.update(WORK,[{id:wid,record:{member:uid},if:{member:null}}],{patch:true})
    ]);
    return json({joined:true});
   }catch(e){if(dbConflict(e))return error('Join conflict',409);throw e;}
  }catch(e){return inviteError(e);}
 }],
 'GET /api/email/status':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o)return error('Workspace unavailable',403);
  const names=await secrets.listSecretNames();
  return json({configured:names.includes('RESEND_API_KEY')&&names.includes('RESEND_FROM_EMAIL')});
 }],
 'POST /api/email/invite':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);
  if(!o||o.m.role!=='owner'||o.w.member)return error('Only an owner without a connected co-parent can send an invite',403);
  const input=c.body as {code?:unknown;email?:unknown;url?:unknown};
  const code=typeof input?.code==='string'?input.code:'';
  const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
  const link=typeof input?.url==='string'?input.url:'';
  if(!code||code.length>256||(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||email.length>150))return error('Invalid invite recipient',400);
  let parsed:URL;
  try { parsed=new URL(link); } catch { return error('Invalid invitation URL',400); }
  if(parsed.protocol!=='https:'||parsed.hostname!=='coparent-expense-manager-udsliz.v2.appdeploy.ai'||parsed.pathname!=='/'||
     !parsed.hash.includes('appdeploy_invite=')||!parsed.hash.includes(encodeURIComponent(code)))
     return error('Invitation link did not pass validation',400);
  try {
    const resolved=await invites.resolve({code,actor:c.user!});
    if(resolved.status!=='open'||resolved.resourceType!=='coparent_workspace'||resolved.context?.workspaceId!==o.id)
      return error('Invitation is expired or does not belong to your workspace',400);
  } catch(e) { return inviteError(e); }
  const names=await secrets.listSecretNames();
  if(!names.includes('RESEND_API_KEY')||!names.includes('RESEND_FROM_EMAIL'))return error('Email delivery is not configured',503);
  const key=await secrets.readSecret('RESEND_API_KEY');
  const from=await secrets.readSecret('RESEND_FROM_EMAIL');
  const payload={from,to:[email],subject:'Invitation to join a shared CoParent workspace',
    text:'You have been invited to collaborate on child expense tracking in CoParent Manager. Open your secure invitation link: '+link+'\\n\\nThis invitation expires after 7 days. If you were not expecting it, you can ignore this email.'};
  let response:Response;
  try {
    response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','User-Agent':'CoParentManager/1.0','Idempotency-Key':'coparent-invite-'+code},
      body:JSON.stringify(payload)
    });
  } catch { return error('Email provider unavailable; please copy the invitation link',502); }
  if(!response.ok){
    console.warn('Email provider rejected invite',response.status);
    return error('Email delivery rejected by provider; check sender verification and configuration',502);
  }
  return json({accepted:true});
 }],
 'POST /api/member/remove':[requireAuth(),async c=>{
  const o=await getWorkspace(c.user!.userId);if(!o||o.m.role!=='owner')return error('Only owner can remove',403);
  const uid=o.w.member;if(!uid)return error('No co-parent connected',400);
  try{
   await db.transact([
    db.tx.delete(MEM,[uid]),
    db.tx.update(WORK,[{id:o.id,record:{member:null},if:{member:uid}}],{patch:true})
   ]);
   return json({removed:true});
  }catch(e){if(dbConflict(e))return error('Membership changed',409);throw e;}
 }]
});