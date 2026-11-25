'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app:server,pool}=require('../server/index.cjs');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});
 const page=await browser.newPage();
 // DM Sans is self-hosted: no third-party request is allowed or stubbed. Record any non-local request.
 const external=[];page.on('request',r=>{if(!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url()))external.push(r.url());});let checks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const state={expenses:[{id:'e1',date:'2026-11-24',description:'School supplies',child:'QA child',category:'Education',payer:'b',amount:10.01,shareA:50,createdBy:'qa-b',createdAt:'2026-11-24T10:00:00Z'}],payments:[],names:{a:'Parent A',b:'Parent B'}};
 let custom=true;let revision=0;let archived=false;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),method=req.method();let data={};
  if(url.pathname==='/api/session')data={user:{userId:'qa-a',email:'qa-a@example.invalid',name:'QA parent',emailVerified:true,legacyAccess:false}};
  if(url.pathname==='/api/workspace')data={exists:true,state,revision,role:'owner',shared:false,archived,profileNames:{a:'A'.repeat(50),b:'B'.repeat(50)}};
  if(url.pathname==='/api/profile'){
   if(method==='DELETE')custom=false;
   data={displayName:custom?'A'.repeat(50):'QA parent',avatarColor:'teal',customized:custom};
  }
  if(url.pathname==='/api/account')data={emailVerified:true,legacyAccess:false,emailDeliveryConfigured:false,deletionRequest:null};
  if(url.pathname==='/api/public/config')data={policiesDraft:true,policyVersion:'2026-11-24-draft',supportUrl:null};
  if(url.pathname==='/api/email/status')data={configured:false};
  if(url.pathname==='/api/notifications')data={revision,items:[{id:'e1',description:'School supplies',amount:10.01,parent:'b',createdAt:'2026-11-24T10:00:00Z',read:false}],unread:99,pending:500,pendingAmount:9999999.99,awaiting:1,awaitingAmount:5};
  await route.fulfill({json:data});
 });
 try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/#/dashboard');await page.locator('#noticeBell').waitFor();
 const widths=[320,360,375,390,414,430,600,768,820,1024,1280,1440,1920];
 const results=[];
 for(const width of widths){
  await page.setViewportSize({width,height:900});
  for(const view of ['dashboard','expenses','payments','report','settings','addExpense','addPayment']){
   await page.evaluate(v=>{location.hash='/'+v},view);await page.waitForTimeout(35);
   const overflow=await page.evaluate(()=>{const width=document.documentElement.clientWidth;return {client:width,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>width+0.5||r.left<-.5||e.scrollWidth>e.clientWidth+1)&&getComputedStyle(e).position!=='fixed'}).map(e=>({tag:e.tagName,class:e.className,id:e.id,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth})).slice(0,12)}});
   assert.ok(overflow.scroll<=overflow.client,JSON.stringify({width,view,...overflow}));checks++;
   if(view==='dashboard'&&[320,768,1440].includes(width))await page.screenshot({path:path.join(__dirname,'../artifacts/dashboard-'+width+'.png'),fullPage:true});
  }
  results.push({width,status:'PASS'});
 }
 // Phase 2 public/account routes must also fit the same supported widths.
 for(const width of widths){
  await page.setViewportSize({width,height:900});
  for(const route of ['privacy','terms','retention','help','security','account','account/reset','account/verify']){
   await page.goto('http://127.0.0.1:'+server.address().port+'/#/'+route);await page.waitForTimeout(45);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'Phase 2 overflow at '+width+' '+route);checks++;
   if(width===360&&route==='account')await page.screenshot({path:path.join(__dirname,'../artifacts/phase2-account-360.png'),fullPage:true});
   if(width===1440&&route==='privacy')await page.screenshot({path:path.join(__dirname,'../artifacts/phase2-privacy-1440.png'),fullPage:true});
  }
 }
 await page.setViewportSize({width:360,height:800});await page.evaluate(()=>location.hash='/settings');await page.waitForTimeout(50);
 for(const id of ['profileName','profileColor','profileEmail','invitationEmail','importfile']){
  assert.ok(await page.locator('#'+id).evaluate(e=>e.labels?.length>0),'Missing associated label '+id);checks++;
 }
 const bell=page.locator('#noticeBell');await bell.focus();await page.keyboard.press('Enter');assert.equal(await bell.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await bell.getAttribute('aria-expanded'),'false');assert.ok(await bell.evaluate(e=>e===document.activeElement));checks++;
 await bell.click();await page.locator('#noticeAllExpenses').focus();await page.keyboard.press('Escape');assert.equal(await bell.getAttribute('aria-expanded'),'false');assert.ok(await bell.evaluate(e=>e===document.activeElement));checks++;
 await bell.click();await page.locator('#noticeAllExpenses').click();await page.waitForTimeout(50);assert.ok(page.url().includes('expenses'));checks++;
 await page.evaluate(()=>location.hash='/settings');await page.waitForTimeout(50);
 await page.locator('#deleteProfile').click();assert.equal(await page.locator('#cp-modal-title').innerText(),'Reset Display Profile');await page.keyboard.press('Escape');checks++;
 await page.locator('#deleteProfile').click();await page.locator('[data-modal-ok]').click();assert.equal(await page.locator('#cp-modal-title').innerText(),'Reset Display Profile');await page.locator('[data-modal-ok]').click();checks++;
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'coparent-backup.json');const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.deepEqual(backup,state);checks++;
 await page.evaluate(()=>location.hash='/report');await page.waitForTimeout(50);assert.ok((await page.locator('body').innerText()).includes('$5.01'));checks++;
 await page.emulateMedia({media:'print'});await page.screenshot({path:path.join(__dirname,'../artifacts/print-report.png'),fullPage:true});const pdf=await page.pdf({format:'A4',path:path.join(__dirname,'../artifacts/qa-report.pdf')});assert.ok(pdf.length>1000);checks++;await page.emulateMedia({media:'screen'});
 await page.setViewportSize({width:740,height:360});await page.evaluate(()=>location.hash='/dashboard');await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));checks++;
 // 1280px viewport at 200% zoom has a 640 CSS-pixel layout viewport.
 await page.setViewportSize({width:640,height:450});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));checks++;
 archived=true;await page.goto('http://127.0.0.1:'+server.address().port+'/#/settings');await page.reload();await page.locator('#accountExport').waitFor();assert.equal(await page.locator('#reset').count(),0);assert.equal(await page.locator('#invitationForm').count(),0);assert.ok((await page.locator('body').innerText()).includes('read-only'));checks++;
 await page.evaluate(()=>location.hash='/addExpense');await page.waitForTimeout(50);assert.equal(await page.locator('#expenseForm').count(),0);assert.ok((await page.locator('body').innerText()).includes('Archived workspace'));checks++;
 assert.deepEqual(errors,[]);checks++;
 // Self-hosted font delivery: loaded from this origin as WOFF2, strict CSP without Google, no external requests.
 await page.goto('http://127.0.0.1:'+server.address().port+'/#/dashboard');await page.waitForTimeout(100);
 assert.ok(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('16px "DM Sans"')&&[...document.fonts].some(f=>f.family.replace(/"/g,'')==='DM Sans'&&f.status==='loaded');}),'DM Sans did not load from self-hosted files');checks++;
 assert.deepEqual(external,[],'unexpected third-party requests');checks++;
 {const html=await fetch('http://127.0.0.1:'+server.address().port+'/');const csp=html.headers.get('content-security-policy')||'';assert.ok(!/googleapis|gstatic/.test(csp)&&/font-src 'self'(;|$)/.test(csp)&&/style-src 'self' 'unsafe-inline'(;|$)/.test(csp),csp);checks++;
  const link=(await html.text()).match(/rel="preload" href="([^"]+\.woff2)"/);assert.ok(link,'font preload link missing');const font=await fetch('http://127.0.0.1:'+server.address().port+link[1]);assert.equal(font.headers.get('content-type'),'font/woff2');assert.match(font.headers.get('cache-control'),/immutable/);checks++;}
 fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../artifacts/qa-dashboard.png'),fullPage:true});
 console.log(JSON.stringify({status:'PASS',checks,widths:results,consoleErrors:errors,fontDelivery:'PASS: self-hosted WOFF2 loaded, preloaded, immutable cache, no third-party requests, CSP without Google hosts',scope:'Browser UI with isolated API fixtures; financial API behavior tested separately'},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));await pool.end();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
