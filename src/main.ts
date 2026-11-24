// @ts-nocheck
import './styles.css';
import './auth.css';
import './account.css';
import { api, auth, invitesClient } from './app-client';
import {policyLinks,renderPolicy} from './policies';
import {accountSection,wireAccount,renderAccountRoute} from './account-ui';
const KEY = 'coparent-mvp-v1';
const oldData = localStorage.getItem(KEY);
let user=null,revision=0,role='owner',shared=false,archived=false,inviteLink='',inviteEmail='',inviteCode='',emailConfigured=false,emailStatus='';
let pendingInvite=invitesClient.getPendingCode();
let profile=null;
let profileNames={a:'Parent A',b:'Parent B'};
function profileCacheKey() {
  return user?.userId ? 'coparent-profile-v1-' + user.userId : null;
}
function getCachedProfile() {
  const key = profileCacheKey();
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || typeof value.displayName !== 'string' || !value.displayName.trim() ||
        value.displayName.length > 50 ||
        !['teal','blue','violet','coral'].includes(value.avatarColor)) return null;
    return {displayName:value.displayName.trim(),avatarColor:value.avatarColor};
  } catch { return null; }
}
function cacheProfile(data) {
  const key=profileCacheKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({
    displayName:data.displayName,avatarColor:data.avatarColor
  })); } catch { /* Browser storage disabled: cloud profile remains the source of truth */ }
}
function clearProfileCache() {
  const key=profileCacheKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* Browser storage disabled */ }
}
function applyOwnProfileName() {
  if(profile?.displayName) profileNames[currentParentKey()]=profile.displayName;
}
const example = {
  expenses: [],
  payments: [],
  names: { a: 'Parent A', b: 'Parent B' },
};
let state;
try {
  state = JSON.parse(localStorage.getItem(KEY)) || structuredClone(example);
} catch {
  state = structuredClone(example);
}
let view = 'dashboard',
  message = '';
let editingExpenseId = null;
const pages = new Set(['dashboard','expenses','pending','payments','report','settings','addExpense','addPayment']);
function routeFromHash() {
  const path = decodeURIComponent(location.hash.slice(1));
  const edit = path.match(/^\/edit\/(.+)$/);
  if (edit) {
    editingExpenseId = edit[1];
    return 'addExpense';
  }
  editingExpenseId = null;
  const target = path.startsWith('/') ? path.slice(1) : '';
  return pages.has(target) ? target : 'dashboard';
}
function navigate(page, expenseId = null) {
  const path = expenseId ? '/edit/' + encodeURIComponent(expenseId) : '/' + page;
  const next = '#' + path;
  if (location.hash === next) {
    view = routeFromHash();
    render();
    return;
  }
  location.hash = path;
}
window.addEventListener('hashchange', async () => {
  if(renderPolicy()||await renderAccountRoute())return;
  if (!user){await boot();return;}
  view = routeFromHash();
  render();
});
const app = document.getElementById('app');
const money = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    n || 0
  );
const safe = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );

function uiModal(message, options = {}) {
  return new Promise(resolve => {
    const confirmMode = !!options.confirm;
    const overlay = document.createElement('div');
    overlay.className = 'cp-modal-overlay';
    overlay.innerHTML = '<section class="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-modal-title" aria-describedby="cp-modal-text">' +
      '<div class="cp-modal-icon" aria-hidden="true">' + (options.destructive ? '!' : confirmMode ? '?' : 'i') + '</div>' +
      '<h2 id="cp-modal-title">' + safe(options.title || (confirmMode ? 'Please confirm' : 'Notice')) + '</h2>' +
      '<p id="cp-modal-text">' + safe(message) + '</p><div class="cp-modal-actions">' +
      (confirmMode ? '<button type="button" class="secondary" data-modal-cancel>Cancel</button>' : '') +
      '<button type="button" class="' + (options.destructive ? 'danger' : 'primary') + '" data-modal-ok>' +
      safe(confirmMode ? (options.okText || 'Confirm') : 'OK') + '</button></div></section>';
    const prev = document.activeElement;
    document.body.appendChild(overlay);
    document.body.classList.add('cp-modal-open');
    const ok = overlay.querySelector('[data-modal-ok]');
    const cancel = overlay.querySelector('[data-modal-cancel]');
    const close = result => {
      overlay.removeEventListener('keydown', keyHandler);
      overlay.remove();
      document.body.classList.remove('cp-modal-open');
      if (prev?.isConnected && prev.focus) prev.focus();
      resolve(result);
    };
    const keyHandler = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const focusable = cancel ? [cancel, ok] : [ok];
        const i = Math.max(0, focusable.indexOf(document.activeElement));
        focusable[(i + (e.shiftKey ? focusable.length - 1 : 1)) % focusable.length].focus();
      }
    };
    overlay.addEventListener('keydown', keyHandler);
    overlay.addEventListener('click', e => { if(e.target === overlay) close(false); });
    ok.onclick = () => close(true);
    if(cancel) cancel.onclick = () => close(false);
    ok.focus();
  });
}
function currentParentKey() { return role === 'member' ? 'b' : 'a'; }
function canEditExpense(e) { return !archived && !!e && (e.createdBy ? e.createdBy === user?.userId : role === 'owner'); }
function parentName(key) {
  return profileNames[key] || (key==='a' ? 'Parent A' : 'Parent B');
}
function payerName(key) {
  return parentName(key) + (key === currentParentKey() ? ' (You)' : '');
}
const localToday = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
const addedTime = stamp => {
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return '';
  return new Date(stamp).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
};
const dt = s =>
  s
    ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
async function save() {
  try {
    const result = await api.put('/api/workspace',{revision,state});
    revision=result.data.revision;
    return true;
  } catch(e) {
    await uiModal('Save failed. Another parent may have updated these records. Latest data will be reloaded. ' + (e?.message || ''));
    await loadWorkspace();
    return false;
  }
}
async function loadWorkspace() {
  const r=await api.get('/api/workspace');
  if(r.data.exists){state=r.data.state;revision=r.data.revision;role=r.data.role;shared=r.data.shared;archived=!!r.data.archived;profileNames=r.data.profileNames||{a:'Parent A',b:'Parent B'};applyOwnProfileName();render();}
}
function details(e) {
  const paid = state.payments
    .filter(p => p.expenseId === e.id)
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalCents = Math.round(e.amount * 100);
  const shareCents = Math.round(totalCents * Math.round(e.shareA * 100) / 10000);
  const owed = (e.payer === 'a' ? totalCents - shareCents : shareCents) / 100;
  return {
    owed,
    paid,
    left: Math.max(0, Math.round((owed - paid) * 100) / 100),
    status: paid >= owed - 0.001 ? 'Settled' : paid > 0 ? 'Partial' : 'Pending',
  };
}
function totals() {
  const a = state.expenses
    .filter(e => e.payer === 'b')
    .reduce((s, e) => s + details(e).left, 0);
  const b = state.expenses
    .filter(e => e.payer === 'a')
    .reduce((s, e) => s + details(e).left, 0);
  const offset = Math.round(Math.min(a,b) * 100) / 100;
  return {
    a,
    b,
    offset,
    netA: Math.max(0, Math.round((a-b)*100)/100),
    netB: Math.max(0, Math.round((b-a)*100)/100),
    all: state.expenses.reduce((s, e) => s + e.amount, 0),
    reimbursed: state.payments.reduce((s, p) => s + p.amount, 0),
  };
}
function cpNavIcon(k){const symbols={"dashboard":"▦","expenses":"▤","payments":"⇄","report":"▥","settings":"⚙"};return '<span class="cp-nav-glyph" aria-hidden="true">'+(symbols[k]||'•')+'</span>';}
let notices={items:[],unread:0,pending:0,pendingAmount:0,awaiting:0,awaitingAmount:0};
let noticeOpen=false,noticeLoading=false,noticeInterval=null;
function noticeHeader(){
  const count=notices.unread||0;
  return '<div class="cp-notice-tools"><button type="button" class="cp-pending-action" id="pendingAction">'+
    '<span class="cp-pending-led"></span>'+(notices.pending?notices.pending+' pending · '+money(notices.pendingAmount):'No payments due')+
    '</button><div class="cp-notice-anchor"><button type="button" id="noticeBell" class="cp-notice-bell" aria-label="Notifications'+
    (count?' ('+count+' unread)':'')+'" aria-expanded="'+noticeOpen+'">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="21" height="21" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>'+
    (count?'<span class="cp-unread-count">'+Math.min(99,count)+'</span>':'')+'</button>'+
    (noticeOpen?noticePanel():'')+'</div></div>';
}
function noticePanel(){
  return '<section role="region" aria-label="Notifications" class="cp-notice-menu">'+
    '<div class="cp-notice-menu-top"><strong>Notifications</strong>'+
    (notices.unread?'<button type="button" id="noticeReadAll">Mark all read</button>':'')+'</div>'+
    '<div class="cp-notice-balances"><div><small>You owe</small><b>'+money(notices.pendingAmount)+'</b><span>'+notices.pending+' pending</span></div>'+
    '<div><small>Awaiting</small><b>'+money(notices.awaitingAmount)+'</b><span>'+notices.awaiting+' expenses</span></div></div>'+
    '<div class="cp-notice-items">'+((notices.items||[]).length?(notices.items||[]).map(n=>
      '<button type="button" data-notice-id="'+safe(n.id)+'" class="cp-notice-item '+(n.read?'':'unread')+'">'+
      '<span class="cp-notice-indicator"></span><span><b>'+safe(parentName(n.parent))+' added an expense</b>'+
      '<small>'+safe(n.description)+' · '+money(n.amount)+'</small>'+
      '<em>'+safe(new Date(n.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'</em></span></button>'
    ).join(''):'<p class="cp-notice-empty">No new expenses to show.</p>')+'</div>'+
    '<button type="button" class="cp-notice-footer" id="noticeAllExpenses">View all expenses</button></section>';
}
async function fetchNotices(){
  if(!user||noticeLoading)return;
  noticeLoading=true;
  try{
    const r=await api.get('/api/notifications');
    const old=JSON.stringify(notices);
    notices=r.data;
    let workspaceChanged=false;
    if(Number.isInteger(notices.revision)&&notices.revision!==revision&&
       !['addExpense','addPayment','settings'].includes(view)&&!document.querySelector('.cp-modal-overlay')){
      const w=await api.get('/api/workspace');
      if(w.data.exists){state=w.data.state;revision=w.data.revision;role=w.data.role;shared=w.data.shared;archived=!!w.data.archived;
        profileNames=w.data.profileNames||profileNames;applyOwnProfileName();workspaceChanged=true;}
    }
    if(workspaceChanged&&document.querySelector('.cp-header'))render();
    else if(old!==JSON.stringify(notices)){
      const tools=document.querySelector('.cp-notice-tools');
      if(tools){
        const activeId=document.activeElement?.id;
        const restore=tools.contains(document.activeElement);
        tools.outerHTML=noticeHeader();wireNotice();
        if(restore&&activeId)document.getElementById(activeId)?.focus();
      }
    }
  }catch{/* Leave last known state visible when network is unavailable */}
  finally{noticeLoading=false;}
}
async function markNotice(ids){
  try{await api.post('/api/notifications/read',{ids});await fetchNotices();}
  catch{await uiModal('Could not mark notifications as read.',{title:'Please retry'});}
}
window.addEventListener('keydown', e=>{
  if(e.key==='Escape' && noticeOpen && !document.querySelector('.cp-modal-overlay')){
    e.preventDefault(); noticeOpen=false; render(); document.getElementById('noticeBell')?.focus();
  }
});
function wireNotice(){
  const bell=document.getElementById('noticeBell');
  if(bell)bell.onclick=()=>{noticeOpen=!noticeOpen;render();document.getElementById('noticeBell')?.focus();};
  const pending=document.getElementById('pendingAction');
  if(pending)pending.onclick=()=>{noticeOpen=false;navigate('pending');};
  const all=document.getElementById('noticeAllExpenses');
  if(all)all.onclick=()=>{noticeOpen=false;navigate('expenses');};
  const read=document.getElementById('noticeReadAll');
  if(read)read.onclick=()=>markNotice((notices.items||[]).filter(n=>!n.read).map(n=>n.id));
  document.querySelectorAll('[data-notice-id]').forEach(button=>{
    button.onclick=async()=>{await markNotice([button.dataset.noticeId]);noticeOpen=false;navigate('expenses');};
  });
}

function welcomeName() {
  const saved = profile?.displayName;
  const fromWorkspace = profileNames[currentParentKey()];
  const provider = user?.name;
  const candidate = saved || ((fromWorkspace === 'Parent A' || fromWorkspace === 'Parent B') ? provider || fromWorkspace : fromWorkspace) || provider || 'there';
  return String(candidate).trim().slice(0, 50) || 'there';
}
function shell(content) {
  app.innerHTML =
    '<div class="shell"><header class="top cp-header">'+
    '<div class="cp-welcome"><span class="cp-welcome-eyebrow">YOUR WORKSPACE</span>'+
    '<div class="cp-welcome-heading">Welcome back, <strong>' + safe(welcomeName()) + '</strong><span class="cp-wave" aria-hidden="true">👋</span></div>'+
    '<p>Here’s what’s happening with your shared expenses.</p></div>'+
    '<div class="header-controls"><span class="pill">' + (shared ? 'Shared workspace' : 'Private workspace') + ' · USD</span>' +
    noticeHeader() +
    ' <button class="header-logout" id="logout" type="button" aria-label="Sign out"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg><span>Sign out</span></button></div></header>'+
    '<nav class="nav" aria-label="Main navigation"><div class="cp-sidebar-brand"><div class="brand-lockup"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 41V25c0-7 5-12 12-12 5 0 9 3 11 7" stroke="white" stroke-width="6.5" stroke-linecap="round"/><path d="M46 23v16c0 7-5 12-12 12-5 0-9-3-11-7" stroke="#A5E4CC" stroke-width="6.5" stroke-linecap="round"/><path d="M26 32c3-3.4 9-3.4 12 0" stroke="white" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="3.4" fill="#E8FFF5"/></svg></div><div class="brand-copy"><div class="brand">CoParent <b>Manager</b></div><div class="sub">Shared expenses. Clearer co-parenting.</div></div></div></div>' +
    [
      ['dashboard', 'Overview'],
      ['expenses', 'Expenses'],
      ['payments', 'Payments'],
      ['report', 'Report'],
      ['settings', 'Settings'],
    ]
      .map(
        ([k, t]) =>
          '<button data-view="' +
          k +
          '" class="' +
          ((k === view || (k === 'expenses' && view === 'pending')) ? 'active' : '') +
          '" title="' + t + '" aria-label="' + t + '"' + (k === view ? ' aria-current="page"' : '') + '>' +
          cpNavIcon(k) + '<span class="cp-nav-label">' + t + '</span>' +
          '</button>'
      )
      .join('') +
    '</nav>' +
    (archived?'<p class="notice" role="status">Archived workspace: financial history is read-only after account closure.</p>':'')+content +
    '</div>';
  wireNotice();
  document.getElementById('logout').onclick=()=>auth.signOut().then(()=>location.reload());
  document.querySelectorAll('[data-view]').forEach(
    x =>
      (x.onclick = () => {
        message = '';
        navigate(x.dataset.view);
      })
  );
}
function heading(title, subtitle, actions = '') {
  // Page headings and subtitles are intentionally omitted from the visual layout.
  // Keep essential page actions (create expense, record payment, print report) accessible.
  return actions
    ? '<div class="cp-page-actions" role="group" aria-label="' + safe(title) + ' actions">' +
      actions + '</div>'
    : '';
}
function button(text, to, type = 'primary') {
  if(archived&&['addExpense','addPayment'].includes(to))return '';
  return (
    '<button class="' + type + '" data-view="' + to + '">' + text + '</button>'
  );
}
function expenseRows(list, showAddedTime = false) {
  return (
    '<div class="cp-table-scroll" role="region" aria-label="Expense records" tabindex="0"><table class="data cp-expense-table"><thead><tr><th>Date</th><th>Description</th><th>Paid by</th><th>Total</th><th>Outstanding</th><th>Status</th>' + '<th>Action</th>' + '</tr></thead><tbody>' +
    list
      .map(e => {
        const d = details(e);
        return (
          '<tr><td>' +
          dt(e.date) +
          (showAddedTime && e.createdAt ? '<div class="expense-created-time">Added ' + safe(addedTime(e.createdAt)) + '</div>' : '') +
          '</td><td><b>' +
          safe(e.description) +
          '</b><div class="muted">' +
          safe(e.child) +
          ' · ' +
          safe(e.category) +
          '</div></td><td>' +
          safe(parentName(e.payer)) +
          '</td><td class="num">' +
          money(e.amount) +
          '</td><td class="num">' +
          money(d.left) +
          '</td><td><span class="status ' +
          d.status.toLowerCase() +
          '">' +
          d.status +
          '</span></td>' + (canEditExpense(e) ? '<td><div class="expense-actions"><button type="button" class="expense-action action-edit" data-edit-expense="' + safe(e.id) + '" aria-label="Edit expense"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4 10.5-10.5z"/></svg><span class="sr-only">Edit expense</span></button>' +
          '<button type="button" class="expense-action action-delete" data-delete-expense="' + safe(e.id) + '" aria-label="Delete expense"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7"/></svg><span class="sr-only">Delete expense</span></button></div></td>' : '<td class="muted">—</td>') + '</tr>'
        );
      })      .join('') +    '</tbody></table></div>'
  );
}
function dashboard() {
  const t = totals(),
    cat = {};
  state.expenses.forEach(
    e => (cat[e.category] = (cat[e.category] || 0) + e.amount)
  );
  let cols = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  return (
    heading(
      'Your financial overview',
      'Everything you need to know, in one place.',
      button('+ Add Expense', 'addExpense') + button('Record Payment', 'addPayment', 'secondary')
    ) +
    '<div class="grid">' +
    [
      ['Total expenses', t.all, 'All recorded shared costs'],
      [
        parentName('a') + ' owes ' + parentName('b'),
        t.a,
        'Outstanding gross obligation · Before optional offset',
      ],
      [
        parentName('b') + ' owes ' + parentName('a'),
        t.b,
        'Outstanding gross obligation · Before optional offset',
      ],      ['Reimbursed', t.reimbursed, 'Payments recorded'],
    ]
      .map(
        a =>
          '<div class="card"><small>' +
          safe(a[0]) +
          '</small><strong>' +
          money(a[1]) +
          '</strong><p>' +
          a[2] +
          '</p></div>'
      )
      .join('') +
    '</div><div class="total"><small class="muted">POTENTIAL NET OFFSET · NOT A RECORDED PAYMENT</small><div><strong>' +
    (Math.abs(t.a - t.b) < 0.001
      ? (t.a > 0 || t.b > 0 ? 'Equal outstanding debts — neither has been settled' : 'No outstanding obligations')
      : t.a > t.b
        ? safe(parentName('a')) +
          ' owes ' +
          safe(parentName('b')) +
          ' ' +
          money(t.a - t.b)
        : safe(parentName('b')) +
          ' owes ' +
          safe(parentName('a')) +
          ' ' +
          money(t.b - t.a)) +
    '</strong></div><div class="muted">Gross obligations: ' + safe(parentName('a')) + ' owes ' + money(t.a) + ' and ' + safe(parentName('b')) + ' owes ' + money(t.b) + '. Potential mutual offset: ' + money(t.offset) + '. This is only an optional netting preview; both gross obligations remain due until an agreed offset or actual payment is recorded. No payment was recorded by this preview.</div></div><div class="below"><div class="panel"><h2>Recent expenses</h2>' +
    (state.expenses.length
      ? expenseRows(state.expenses.slice(-5).reverse(), true)
      : '<div class="empty">No expenses yet. Add your first expense to begin.</div>') +
    '</div><div class="panel"><h2>Spending categories</h2>' +
    (cols.length
      ? cols
          .map(
            ([k, v]) =>
              '<div class="listrow"><span>' +
              safe(k) +
              '</span><b>' +
              money(v) +
              '</b></div><div class="bar"><div class="fill" style="width:' +
              Math.round((100 * v) / t.all) +
              '%"></div></div>'
          )
          .join('')
      : '<div class="empty">Your category breakdown will appear here.</div>') +    '</div></div><p class="notice">Records are stored in the signed-in shared workspace. Net balances are an offset preview, not a recorded payment.</p>'
  );
}
function expList() {
  return (
    heading(
      'Expenses',
      'All shared expenses, automatically split.',
      button('+ Add Expense', 'addExpense')
    ) +
    '<div class="panel">' +
    (state.expenses.length
      ? expenseRows(state.expenses)
      : '<div class="empty">No expenses yet.</div>') +
    '</div>'
  );
}
function pendingExpenses() {
  const mine = state.expenses.filter(e => e.payer !== currentParentKey() && details(e).left > 0.001);
  return '<section class="panel cp-obligation-panel" aria-label="Your outstanding reimbursements">' +
    '<div class="cp-obligation-heading"><h2>You owe — pending expenses</h2>' +
    '<button class="secondary" data-view="expenses" type="button">All expenses</button></div>' +
    '<p class="muted">Expenses paid by your co-parent that you still owe. If you already reimbursed them, ask the original expense creator to record the reimbursement.</p>' +
    (mine.length ? expenseRows(mine) : '<div class="empty">You have no pending reimbursements.</div>') +
    '</section>';
}
function payList() {
  return (
    heading(
      'Payments',
      'Track reimbursements against an expense.',
      button('+ Record Payment', 'addPayment')
    ) +
    '<div class="panel">' +
    (state.payments.length
      ? '<div class="cp-table-scroll" role="region" aria-label="Payment records" tabindex="0"><table class="data cp-payment-table"><tr><th>Date</th><th>Expense</th><th>From</th><th>To</th><th>Amount</th></tr>' +
        state.payments
          .map(
            p =>
              '<tr><td>' +
              dt(p.date) +
              '</td><td>' +
              safe(p.expenseId) +
              '</td><td>' +
              safe(parentName(p.from)) +
              '</td><td>' +
              safe(parentName(p.to)) +
              '</td><td class="num">' +
              money(p.amount) +
              '</td></tr>'
          )
          .join('') +
        '</table></div>'
      : '<div class="empty">No reimbursements recorded.</div>') +
    '</div>'
  );
}
function expenseForm() {
  if(archived)return '<section class="panel"><h2>Archived workspace</h2><p>This ledger is read-only. You can view records, reports and exports.</p></section>';
  const current = state.expenses.find(e => e.id === editingExpenseId);
  if (current && !canEditExpense(current)) return heading('Access restricted', 'You can only edit expenses you added.') + '<div class="panel">This expense belongs to the other parent.</div>';
  const value = (key, fallback = '') => safe(current ? current[key] : fallback);
  const selected = (key, expected) => (current ? current[key] === expected : (key === 'payer' && expected === currentParentKey())) ? ' selected' : '';
  const categories = ['Education', 'Healthcare', 'Childcare', 'Activities', 'Clothing', 'Other'];
  return heading(
      current ? 'Edit expense' : 'Add an expense',
      current ? 'Update the details. Your balances will recalculate.' : 'Just enter the details. We calculate the split for you.'
    ) +
    '<form class="form" id="expenseForm"><h2>Expense details</h2><div class="fields">' +
    '<div class="field"><label for="expenseDate">Expense date</label><input id="expenseDate" name="date" type="date" value="' + value('date', localToday()) + '" required><div class="muted">Defaults to today. Change it if the expense happened on another day.</div></div>' +
    '<div class="field"><label for="expenseChild">Child / reference</label><input id="expenseChild" name="child" value="' + value('child') + '" required maxlength="80"></div>' +
    '<div class="field wide"><label for="expenseDescription">What was the expense?</label><input id="expenseDescription" name="description" value="' + value('description') + '" required maxlength="100"></div>' +
    '<div class="field"><label for="expenseCategory">Category</label><select id="expenseCategory" name="category">' +
      categories.map(c => '<option' + selected('category', c) + '>' + c + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="expensePayer">Paid upfront by</label><input id="expensePayer" type="text" value="' + safe(current ? parentName(current.payer) : payerName(currentParentKey())) + '" disabled aria-label="Paying parent (locked)" class="locked-payer"><input type="hidden" name="payer" value="' + (current ? current.payer : currentParentKey()) + '"><div class="muted">Automatically assigned to your signed-in account for new expenses.</div></div>' +
    '<div class="field"><label for="expenseAmount">Total amount (USD)</label><input id="expenseAmount" name="amount" type="number" min="0.01" max="1000000" step="0.01" value="' + value('amount') + '" required></div>' +
    '<div class="field"><label>' + safe(parentName('a')) + ' agreed share (%)</label><input id="expenseShare" aria-label="Agreed share percentage for Parent A" name="shareA" type="number" min="0" max="100" step="0.01" value="' + value('shareA',50) + '" required>' +
    '<div class="muted">' + safe(parentName('b')) + ' gets the remainder.</div></div></div>' +
    '<div class="notice">' +
    (current && state.payments.some(p => p.expenseId === current.id)
     ? 'Reimbursements already exist. The payer cannot change and the new amount owed must cover all recorded payments.'
     : 'You can only edit expenses you created. Other parent expenses are visible but cannot be edited from your account.') +
    '</div><div id="formerror" role="alert" aria-live="assertive"></div><div class="formfoot"><button class="primary" type="submit">' +
    (current ? 'Save Changes' : 'Save Expense') + '</button>' +
    button('Cancel','expenses','secondary') + '</div></form>';
}
function paymentForm() {
  if(archived)return '<section class="panel"><h2>Archived workspace</h2><p>This ledger is read-only. You can view records, reports and exports.</p></section>';
  const eligible = state.expenses.filter(e => canEditExpense(e) && details(e).left > 0.001);
  return (
    heading(
      'Record a reimbursement',
      'Choose an expense and enter the money actually received.'
    ) +
    '<form class="form" id="paymentForm"><h2>Payment details</h2>' +
    (eligible.length
      ? '<div class="fields"><div class="field"><label for="paymentDate">Payment date</label><input id="paymentDate" name="date" type="date" required></div><div class="field"><label for="paymentExpense">Expense being reimbursed</label><select id="paymentExpense" name="expenseId">' +
        eligible
          .map(
            e =>              '<option value="' +
              safe(e.id) +
              '">' +
              safe(e.description) +
              ' · ' +
              money(details(e).left) +
              ' left</option>'
          )
          .join('') +
        '</select></div><div class="field"><label for="paymentAmount">Amount paid (USD)</label><input id="paymentAmount" name="amount" type="number" step="0.01" min="0.01" required placeholder="40.00"></div><div class="field"><label for="paymentMethod">Payment method</label><select id="paymentMethod" name="method"><option>Bank transfer</option><option>Cash</option><option>Payment app</option><option>Other</option></select></div></div><div class="notice">The app automatically determines who owes whom from the expense.</div><div id="formerror" role="alert" aria-live="assertive"></div><div class="formfoot"><button class="primary" type="submit">Save Payment</button>' +
        button('Cancel', 'payments', 'secondary') +
        '</div>'
      : '<p class="muted">First add an expense with a balance owed.</p>' +
        button('Add Expense', 'addExpense')) +
    '</form>'
  );
}
function report() {
  const t = totals();
  return (
    heading(
      'Printable report',      'A simple summary to review or print.',
      '<button class="secondary" id="print">Print / Save PDF</button>'
    ) +
    '<div class="panel"><h2>Expense and reimbursement summary</h2><div class="muted">Generated on ' +
    new Date().toLocaleDateString() +
    '</div><div class="listrow"><span>Total shared expenses</span><b>' +
    money(t.all) +
    '</b></div><div class="listrow"><span>' +
    safe(parentName('a')) +
    ' owes ' +
    safe(parentName('b')) +
    '</span><b>' +
    money(t.a) +
    '</b></div><div class="listrow"><span>' +
    safe(parentName('b')) +
    ' owes ' +
    safe(parentName('a')) +    '</span><b>' +
    money(t.b) +
    '</b></div><div class="listrow"><span>Reimbursements recorded</span><b>' +
    money(t.reimbursed) +
    '</b></div><div class="listrow"><span>Potential mutual offset</span><b>' + money(t.offset) + '</b></div>' +
    '<div class="listrow"><span>Net ' + safe(parentName('a')) + ' owes ' + safe(parentName('b')) + '</span><b>' + money(t.netA) + '</b></div>' +
    '<div class="listrow"><span>Net ' + safe(parentName('b')) + ' owes ' + safe(parentName('a')) + '</span><b>' + money(t.netB) + '</b></div>' +
    '<p class="notice">Net figures are informational only. Both parents must agree to an actual offset.</p><h2 style="margin-top:26px">Expense details</h2>' +
    (state.expenses.length
      ? expenseRows(state.expenses)
      : '<div class="empty">No expenses</div>') +
    '</div><p class="notice">For organizational use only. Not a legal or court-certified report.</p>'
  );
}
function profileSection() {
  const displayName = profile?.displayName || user?.name || '';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'P';
  const shade = profile?.avatarColor || 'teal';
  const colors = [
    ['teal','Teal'],['blue','Blue'],['violet','Violet'],['coral','Coral']
  ];
  return '<section class="panel profile-panel" aria-label="My profile">' +
    '<div class="profile-heading"><div class="profile-avatar color-' + safe(shade) + '">' + safe(initial) + '</div>' +
    '<div><h2>My Profile</h2><p class="muted">Manage your own profile. These details do not change the other parent\'s account.</p></div></div>' +
    '<form id="profileForm"><div class="fields">' +
    '<div class="field"><label for="profileName">Display name</label><input id="profileName" name="displayName" maxlength="50" required placeholder="Your name" value="' + safe(displayName) + '"></div>' +
    '<div class="field"><label for="profileColor">Avatar color</label><select id="profileColor" name="avatarColor">' +
    colors.map(([value,label])=>'<option value="' + value + '"' + (shade===value?' selected':'') + '>' + label + '</option>').join('') +
    '</select></div></div>' +
    '<div class="field profile-email"><label for="profileEmail">Email (sign-in identity)</label><input id="profileEmail" type="email" value="' + safe(user?.email || '') + '" disabled><div class="muted">Email is managed by your sign-in provider and cannot be changed here.</div></div>' +
    '<div class="profile-actions"><button type="submit" class="primary">Save Profile</button>' +
    '<button type="button" class="danger" id="deleteProfile">Reset Display Profile</button></div>' +
    '<p class="muted">Reset Display Profile removes your custom display name and avatar color. Your login account, workspace membership and financial records remain unchanged.</p>' +
    '</form></section>';
}

function settings() {
  if(archived)return heading('Settings','Archived workspace')+profileSection()+accountSection(user)+'<section class="panel cp-account-panel"><h2>Archived workspace</h2><p>This ledger is read-only after account closure. Its financial history remains available to the remaining parent. New expenses, payments, invitations and shared-data changes are disabled.</p><button id="export" class="secondary">Download Backup</button></section>';
  if (role !== 'owner') return heading('Settings', 'Your personal account and access.') + profileSection() + accountSection(user) + '<div class="panel" style="max-width:760px;margin-top:20px"><h2>Workspace access</h2><p class="muted">You can manage your own expenses and payments and view the shared records. Only the workspace owner can change workspace settings and invitations.</p></div>';
  return (
    heading('Settings', 'Manage your profile and shared workspace.') + profileSection() + accountSection(user) +
    '<div class="panel" style="max-width:760px;margin-top:20px"><h2>Backup and reset</h2><p class="muted">Records are stored on the PostgreSQL-backed server in your signed-in shared workspace. Downloading a JSON backup creates an extra copy; importing one validates the shared ledger without allowing another parent?s entries or recorded reimbursements to be erased. Do not share your backup with anyone who should not see family financial data.</p><div class="toolbar"><button class="secondary" id="export">Download Backup</button><button class="secondary" id="import">Import Backup</button><label for="importfile" class="sr-only">Import JSON workspace backup</label><input id="importfile" type="file" accept="application/json" hidden><button class="danger" id="reset">Clear eligible workspace data</button></div></div>' +
    '<div class="panel" style="max-width:760px;margin-top:20px"><h2>Co-parent sharing</h2><p class="muted">Your workspace is private until you invite a co-parent by their specific email.</p>' +
    (role==='owner' ? (shared ?
      '<div class="callout">A co-parent is connected. Each parent can manage their own expenses, but not the other parent\'s.</div><button class="danger" id="removeMember" style="padding:10px;border-radius:9px">Remove access</button>' :
      '<form id="invitationForm" class="toolbar"><label for="invitationEmail" class="sr-only">Co-parent email</label><input id="invitationEmail" name="email" type="email" placeholder="Co-parent email" required style="padding:11px;border:1px solid #dde5e2;border-radius:9px"><button class="primary" type="submit">Create Invite</button></form>' +
      (inviteLink ?
        '<div class="callout" style="overflow-wrap:anywhere">' + safe(inviteLink) + '</div>' +
        '<div class="toolbar"><button class="secondary" id="copyLink">Copy link</button>' +
        '<button class="primary" id="sendInviteEmail"' + (!emailConfigured ? ' disabled title="Email delivery not configured"' : '') + '>Send Email Invite</button></div>' +
        '<p class="notice">Recipient: ' + safe(inviteEmail) + '</p>' +
        (!emailConfigured ? '<p class="error">Automatic email sending needs Resend configuration. You can still copy the invitation link.</p>' : '') +
        (emailStatus ? '<div class="callout">' + safe(emailStatus) + '</div>' : '') : '')
    ) : '<p class="muted">Your workspace owner manages sharing.</p>') + '</div>' +
    (oldData ? '<div class="panel" style="max-width:760px;margin-top:20px"><h2>Old browser records</h2><p class="muted">Optional: import your previous browser-only data. This REPLACES current workspace records. Export a backup first.</p><button class="secondary" id="importOld" style="padding:10px;border-radius:9px">Import old records</button></div>' : '')
  );
}
function render() {
  
  const body = (    {
      dashboard,
      expenses: expList,
      pending: pendingExpenses,
      payments: payList,
      addExpense: expenseForm,
      addPayment: paymentForm,
      report,
      settings,
    }[view] || dashboard
  )();
  shell(body);
  wire();
}
function wire() {
  wireAccount(user);
  const profileForm = document.getElementById('profileForm');
  if(profileForm) profileForm.onsubmit=async e=>{
    e.preventDefault();
    const form=new FormData(profileForm);
    const displayName=String(form.get('displayName')||'').trim();
    const avatarColor=String(form.get('avatarColor')||'teal');
    if(!displayName||displayName.length>50){await uiModal('Enter a display name up to 50 characters.',{title:'Check profile'});return;}
    try{
      const r=await api.put('/api/profile',{displayName,avatarColor});
      profile={displayName:r.data.displayName,avatarColor:r.data.avatarColor};
      cacheProfile(profile);
      profileNames[currentParentKey()]=profile.displayName;
      render();
      await uiModal('Your profile was updated.',{title:'Profile saved'});
    }catch(err){await uiModal('Profile update failed: '+(err?.message||'Please retry.'),{title:'Save failed'});}
  };
  const deleteProfile=document.getElementById('deleteProfile');
  if(deleteProfile) deleteProfile.onclick=async()=>{
    const yes=await uiModal('Remove your custom display name and avatar? Your login account, membership and financial records will stay unchanged.',{confirm:true,destructive:true,title:'Reset Display Profile',okText:'Reset Display Profile'});
    if(!yes)return;
    try{
      await api.delete('/api/profile');
      clearProfileCache();
      profile=null;
      profileNames[currentParentKey()]=user?.name || (currentParentKey()==='a'?'Parent A':'Parent B');
      render();
      await uiModal('Reset Display Profile completed. Your login account, workspace membership and financial records remain unchanged.',{title:'Reset Display Profile'});
    }catch(err){await uiModal('Could not reset display profile: '+(err?.message||'Please retry.'),{title:'Reset failed'});}
  };
  document.querySelectorAll('[data-delete-expense]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.deleteExpense;
      const expense = state.expenses.find(e => e.id === id);
      if (!expense) { await uiModal('Expense no longer exists.'); return; }
      if (!canEditExpense(expense)) { await uiModal('You cannot delete another parent’s expense.'); return; }
      if (state.payments.some(p => p.expenseId === id)) {
        await uiModal('Cannot delete an expense with recorded reimbursements. Payment history is protected.');
        return;
      }
      if (!(await uiModal('Delete ' + expense.description + ' (' + money(expense.amount) + ')? This cannot be undone.', {confirm:true,destructive:true,okText:'Delete Expense'}))) return;
      btn.disabled = true;
      const original = state.expenses;
      state.expenses = original.filter(e => e.id !== id);
      if (!await save()) return;
      navigate('expenses');
    };
  });
  const invitationForm=document.getElementById('invitationForm');  if(invitationForm) invitationForm.onsubmit=async e=>{
    e.preventDefault();
    try{
      const r=await api.post('/api/invite',{email:new FormData(invitationForm).get('email')});
      inviteCode=r.data.code;
      inviteEmail=String(new FormData(invitationForm).get('email')).trim().toLowerCase();
      inviteLink=invitesClient.buildJoinUrl(inviteCode,{path:'#/join'});
      emailStatus='';
      try {
        const config=await api.get('/api/email/status');
        emailConfigured=!!config.data.configured;
      } catch { emailConfigured=false; }
      render();
    }catch(err){await uiModal('Invite could not be created: '+(err?.message||''));}
  };
  const sendInviteEmail=document.getElementById('sendInviteEmail');
  if(sendInviteEmail)sendInviteEmail.onclick=async()=>{
    sendInviteEmail.disabled=true;
    sendInviteEmail.textContent='Sending…';
    try {
      const result=await api.post('/api/email/invite',{email:inviteEmail,code:inviteCode,url:inviteLink});
      emailStatus=result.data.accepted ? 'Email accepted by the delivery provider. Check recipient inbox and spam folder.' : 'Email was not accepted.';
      render();
    } catch(err) {
      emailStatus='Email could not be sent. Copy the link instead. ' + (err?.message || '');
      render();
    }
  };
  const copyLink=document.getElementById('copyLink');
  if(copyLink)copyLink.onclick=async()=>{try{await navigator.clipboard.writeText(inviteLink);await uiModal('Invite link copied',{title:'Link copied'});}catch{await uiModal('Copy did not work. Please copy the link manually.',{title:'Copy failed'});}};
  const removeMember=document.getElementById('removeMember');
  if(removeMember)removeMember.onclick=async()=>{
    if(!(await uiModal('Remove co-parent access?', {confirm:true,destructive:true,okText:'Remove Access'})))return;
    try{await api.post('/api/member/remove',{});await loadWorkspace();}catch(err){await uiModal('Could not remove access: '+(err?.message||''));}
  };
  const importOld=document.getElementById('importOld');
  if(importOld)importOld.onclick=async()=>{
    if(!(await uiModal('Replace ALL current shared records with old browser records?', {confirm:true,destructive:true,okText:'Replace Records'})))return;
    try{const old=JSON.parse(oldData);if(!Array.isArray(old.expenses)||!Array.isArray(old.payments))throw Error('Invalid records');
      state=old;if(await save()){localStorage.removeItem(KEY);await uiModal('Import complete');render();}
    }catch(err){await uiModal('Import failed: '+(err?.message||''));}
  };
  document.querySelectorAll('[data-edit-expense]').forEach(btn => {
    btn.onclick = () => {
      if (!canEditExpense(state.expenses.find(e=>e.id===btn.dataset.editExpense))) return;
      navigate('addExpense', btn.dataset.editExpense);
    };
  });
  const ef = document.getElementById('expenseForm');
  if (ef)
    ef.onsubmit = async e => {
      e.preventDefault();
      if(ef.dataset.saving==='true')return;
      const f = new FormData(ef);
      const amount = Number(f.get('amount')),
        shareA = Number(f.get('shareA'));
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isFinite(shareA) ||
        shareA < 0 ||
        shareA > 100
      ) {
        document.getElementById('formerror').innerHTML =
          '<div class="error">Enter a valid amount and split.</div>';
        return;
      }
      const existing = state.expenses.find(x => x.id === editingExpenseId);
      if(existing && !canEditExpense(existing)){ await uiModal('You cannot edit another parent’s expense.'); return; }
      const payer = existing ? existing.payer : currentParentKey();
      const cents = Math.round(amount * 100);
      const shareCents = Math.round(cents * Math.round(shareA * 100) / 10000);
      const newOwed = (payer === 'a' ? cents - shareCents : shareCents) / 100;
      if (existing && state.payments.some(p => p.expenseId === existing.id)) {
        const received = state.payments.filter(p => p.expenseId === existing.id)
          .reduce((sum,p) => sum + Number(p.amount),0);
        if (payer !== existing.payer || newOwed + 0.001 < received) {
          document.getElementById('formerror').innerHTML =
            '<div class="error">This expense has payments. You cannot change its paying parent or reduce the amount owed below the amount already received.</div>';
          return;
        }
      }
      const updated = {
        id: existing ? existing.id : 'E' + crypto.randomUUID(),
        date: String(f.get('date')),
        child: String(f.get('child')).trim(),
        description: String(f.get('description')).trim(),
        category: String(f.get('category')),
        payer,
        amount: cents / 100,
        shareA,
        createdBy: existing ? existing.createdBy : user.userId,
        ...(existing ? (existing.createdAt ? {createdAt:existing.createdAt} : {}) : {createdAt:new Date().toISOString()}),
      };
      ef.dataset.saving='true';
      ef.querySelector('[type=submit]').disabled=true;
      if (existing) Object.assign(existing, updated);
      else state.expenses.push(updated);
      editingExpenseId = null;
      if (!await save()) return;
      view = 'expenses';
      render();
    };
  const pf = document.getElementById('paymentForm');
  if (pf)
    pf.onsubmit = async e => {
      e.preventDefault();
      if(pf.dataset.saving==='true')return;
      const f = new FormData(pf),
        exp = state.expenses.find(x => x.id === f.get('expenseId')),
        allowed = canEditExpense(exp),
        amount = Math.round(Number(f.get('amount')) * 100) / 100;
      if (
        !exp ||
        !allowed ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > details(exp).left + 0.001
      ) {
        document.getElementById('formerror').innerHTML =
          '<div class="error">Payment must be positive and cannot exceed the outstanding amount.</div>';
        return;
      }
      pf.dataset.saving='true';
      pf.querySelector('[type=submit]').disabled=true;
      state.payments.push({
        id: 'P' + crypto.randomUUID(),
        expenseId: exp.id,
        date: String(f.get('date')),
        amount,
        from: exp.payer === 'a' ? 'b' : 'a',
        to: exp.payer,
        method: String(f.get('method')),
        createdBy: user.userId,
      });
      if (!await save()) return;
      navigate('dashboard');
    };
  const pr = document.getElementById('print');
  if (pr) pr.onclick = () => window.print();
  const ex = document.getElementById('export');
  if (ex)
    ex.onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], {
          type: 'application/json',
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'coparent-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    };
  const im = document.getElementById('import'),
    file = document.getElementById('importfile');
  if (im) im.onclick = () => file.click();
  if (file)
    file.onchange = async () => {      try {
        const obj = JSON.parse(await file.files[0].text());
        if (
          !Array.isArray(obj.expenses) ||
          !Array.isArray(obj.payments) ||
          !obj.names ||
          !(await uiModal('Replace current records with this backup?', {confirm:true,destructive:true,okText:'Import Backup'}))
        )
          return;
        state = obj;
        if (!await save()) return;
        navigate('dashboard');
      } catch {
        await uiModal('Invalid backup file');
      }
    };
  const re = document.getElementById('reset');
  if (re)
    re.onclick = async () => {
      if (await uiModal('Permanently delete ALL records in this shared workspace?', {confirm:true,destructive:true,okText:'Delete All'})) {
        state = structuredClone(example);
        if (!await save()) return;
        view = 'dashboard';
        render();
      }
    };
}
async function boot(){
  if(renderPolicy()||await renderAccountRoute())return;
  app.innerHTML='<div class="shell"><div class="panel">Loading secure workspace...</div></div>';
  try{
    user=await auth.getUser();
    if(!user){
      app.innerHTML='<div class="shell"><div class="form" style="margin:9vh auto;text-align:center"><h1>CoParent Manager</h1><p class="muted">Simple, private co-parent expense tracking.</p><button class="primary" id="login" style="padding:13px 22px;border-radius:9px">Sign in / Create account</button>'+policyLinks()+'</div></div>';
      document.getElementById('login').onclick=async()=>{try{await auth.signInWithRedirect();}catch(e){await uiModal('Login failed. Try again.');}};
      return;
    }
    const r=await api.get('/api/workspace');
    if(!r.data.exists){
      app.innerHTML='<div class="shell"><div class="form" style="margin:8vh auto"><h1>Welcome to CoParent</h1><p class="muted">Manage expenses alone or join a shared workspace.</p>'+
       (pendingInvite?'<div class="callout">You have an invitation to join a co-parent workspace.</div><button class="primary" id="join" style="padding:11px;border-radius:9px;margin:12px 0">Accept Invitation</button><hr style="border:0;border-top:1px solid #eee;margin:20px 0">':'')+
       '<p><a href="#/account">Account management / Verify email</a></p><h2>Start in private mode</h2><p class="muted">Invite your co-parent later, only if you want to.</p><button class="secondary" id="create" style="padding:11px;border-radius:9px">Create My Workspace</button><div class="notice">Signed in as '+safe(user.email||'account')+'</div><button class="secondary" id="logoutOnboard" style="margin-top:10px;padding:9px;border-radius:9px">Sign out</button></div></div>';
      document.getElementById('create').onclick=async()=>{try{await api.post('/api/workspace',{});pendingInvite=null;invitesClient.clearPendingCode();await boot();}catch(e){await uiModal('Creation failed: '+(e?.message||''));}};
      if(pendingInvite)document.getElementById('join').onclick=async()=>{try{await api.post('/api/invite/'+encodeURIComponent(pendingInvite)+'/join',{});invitesClient.clearPendingCode();pendingInvite=null;await boot();}catch(e){await uiModal('Invite join failed. Check you signed in using the invited email. '+(e?.message||''));}};
      document.getElementById('logoutOnboard').onclick=()=>auth.signOut().then(()=>location.reload());
      return;
    }
    state=r.data.state;revision=r.data.revision;role=r.data.role;shared=r.data.shared;archived=!!r.data.archived;profileNames=r.data.profileNames||{a:'Parent A',b:'Parent B'};
    const cachedProfile=getCachedProfile();
    profile=cachedProfile;
    applyOwnProfileName();
    try {
      const p=await api.get('/api/profile');
      if(p.data.customized && p.data.displayName) {
        profile={displayName:p.data.displayName,avatarColor:p.data.avatarColor};
        cacheProfile(profile);
      }else{profile=null;clearProfileCache();}
      applyOwnProfileName();
    } catch { /* Keep per-user local cache if cloud profile cannot be loaded */ }
    try {
      const config=await api.get('/api/email/status');
      emailConfigured=!!config.data.configured;
    } catch { emailConfigured=false; }
    if(pendingInvite){invitesClient.clearPendingCode();pendingInvite=null;}    if (!location.hash || location.hash === '#/join') {
      history.replaceState(null, '', location.pathname + location.search + '#/dashboard');
    }
    view = routeFromHash();
    render();
    void fetchNotices();
    if(!noticeInterval)noticeInterval=setInterval(()=>{if(!document.hidden)void fetchNotices();},30000);
  }catch(e){
    app.innerHTML='<div class="shell"><div class="panel"><h2>Could not load your workspace</h2><p class="muted">No data was deleted. Please retry.</p><button id="retry" class="primary" style="padding:12px;border-radius:9px">Retry</button></div></div>';
    document.getElementById('retry').onclick=boot;
  }
}
boot();
