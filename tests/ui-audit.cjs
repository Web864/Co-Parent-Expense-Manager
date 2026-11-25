'use strict';
// UI audit harness (no database needed; API is stubbed like tests/browser.cjs).
//   node tests/ui-audit.cjs contrast            per-element WCAG contrast against the real composited background
//   node tests/ui-audit.cjs shots <dir>         screenshots for before/after visual comparison
//   node tests/ui-audit.cjs responsive          widths incl. 2560, 200%/400% zoom reflow, forced-colors, keyboard focus
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path');
const {app:server}=require('../server/index.cjs');
const mode=process.argv[2]||'contrast',outDir=process.argv[3];
const state={expenses:[{id:'e1',date:'2026-11-24',description:'School supplies',child:'QA child',category:'Education',payer:'b',amount:10.01,shareA:50,createdBy:'qa-b',createdAt:'2026-11-24T10:00:00Z'},
 {id:'e2',date:'2026-11-20',description:'Football boots',child:'Second child',category:'Sports',payer:'a',amount:60,shareA:70,createdBy:'qa-a',createdAt:'2026-11-20T10:00:00Z'}],
 payments:[{id:'p1',expenseId:'e2',date:'2026-11-21',amount:10,from:'b',to:'a',method:'Cash',createdBy:'qa-a'}],names:{a:'Parent A',b:'Parent B'}};
async function setup(browser,{signedIn=true,longNames=false}={}){
 const context=await browser.newContext(),page=await context.newPage();
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let data={};
  if(url.pathname==='/api/session')data={user:signedIn?{userId:'qa-a',email:'qa-a@example.invalid',name:'QA parent',emailVerified:true,legacyAccess:false}:null};
  if(url.pathname==='/api/workspace')data={exists:true,state,revision:0,role:'owner',shared:false,archived:false,profileNames:longNames?{a:'A'.repeat(50),b:'B'.repeat(50)}:{a:'Parent A',b:'Parent B'}};
  if(url.pathname==='/api/profile')data={displayName:longNames?'A'.repeat(50):'QA parent',avatarColor:'teal',customized:true};
  if(url.pathname==='/api/account')data={emailVerified:true,legacyAccess:false,emailDeliveryConfigured:false,deletionRequest:null};
  if(url.pathname==='/api/public/config')data={policiesDraft:true,policyVersion:'2026-11-24-draft',supportUrl:null};
  if(url.pathname==='/api/email/status')data={configured:false};
  if(url.pathname==='/api/notifications')data={revision:0,items:[{id:'e1',description:'School supplies',amount:10.01,parent:'b',createdAt:'2026-11-24T10:00:00Z',read:false}],unread:1,pending:1,pendingAmount:5.01,awaiting:1,awaitingAmount:20};
  await route.fulfill({json:data});});
 return {context,page};
}
const base=()=>'http://127.0.0.1:'+server.address().port;
const APP=['dashboard','expenses','payments','report','settings','addExpense','addPayment'];
const PUBLIC=['privacy','terms','retention','help','security','account','account/reset','account/verify'];
async function go(page,hash,wait=60){await page.evaluate(h=>{location.hash=h},hash);await page.waitForTimeout(wait);}
// ---- in-page contrast scanner ----
const scanner=()=>{
 const parse=s=>{const m=s.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
 const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
 const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 // Backgrounds under an element: list of candidate solid colours (several for gradients) -> worst case.
 const backdrops=el=>{let layers=[];for(let n=el;n&&n.nodeType===1;n=n.parentElement){const cs=getComputedStyle(n);const bg=parse(cs.backgroundColor);const img=cs.backgroundImage;
   if(img&&img!=='none'){const stops=[...img.matchAll(/rgba?\([^)]+\)/g)].map(m=>parse(m[0])).filter(Boolean);if(stops.length){layers.push({stops});if(stops.every(s=>s.a===1))break;continue;}}
   if(bg&&bg.a>0){layers.push({stops:[bg]});if(bg.a===1)break;}}
  let results=[{r:255,g:255,b:255,a:1}];
  for(const layer of layers.reverse()){const next=[];for(const under of results)for(const s of layer.stops)next.push(over(s,under));results=next;}
  return results;};
 const out=[];
 for(const el of document.querySelectorAll('body *')){
  if(!(el.firstChild&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())))continue;
  const cs=getComputedStyle(el),r=el.getBoundingClientRect();
  if(cs.visibility==='hidden'||cs.display==='none'||r.width<1||r.height<1||el.closest('[aria-hidden="true"]')||el.disabled||el.getAttribute('aria-disabled')==='true')continue;
  if(el.closest('script,style,noscript'))continue;
  let opacity=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);
  const fg=parse(cs.color);if(!fg)continue;
  const size=parseFloat(cs.fontSize),weight=Number(cs.fontWeight),large=size>=24||(size>=18.66&&weight>=700);
  let worst=99,worstBg=null;
  for(const bg of backdrops(el)){const eff=opacity<1?over({...fg,a:fg.a*opacity},bg):over(fg,bg);const v=ratio(eff,bg);if(v<worst){worst=v;worstBg=bg;}}
  const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  out.push({sel:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):''),text:el.textContent.trim().slice(0,28),fg:hex(fg),bg:hex(worstBg),ratio:Math.round(worst*100)/100,need:large?3:4.5,size,weight,opacity});
 }
 return out;
};
async function contrast(browser){
 const fails=new Map(),small=new Map();let scanned=0;
 const record=(rows,view,width)=>{for(const x of rows){scanned++;
   if(x.ratio<x.need){const k=[x.fg,x.bg,x.size,x.sel].join('|');const e=fails.get(k)||{...x,views:new Set()};e.views.add(view);fails.set(k,e);}
   if(x.size<12){const k=[x.sel,x.size].join('|');const e=small.get(k)||{sel:x.sel,size:x.size,text:x.text,views:new Set()};e.views.add(view);small.set(k,e);}}};
 {const {context,page}=await setup(browser);await page.setViewportSize({width:1440,height:900});await page.goto(base()+'/#/dashboard');await page.locator('#noticeBell').waitFor();
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:900});
   for(const v of APP){await go(page,'/'+v);record(await page.evaluate(scanner),v+'@'+width);}
   await go(page,'/dashboard');await page.locator('#noticeBell').click().catch(()=>{});await page.waitForTimeout(80);record(await page.evaluate(scanner),'notifications@'+width);await page.keyboard.press('Escape');}
  for(const route of PUBLIC){await page.goto(base()+'/#/'+route);await page.waitForTimeout(80);record(await page.evaluate(scanner),route);}
  await context.close();}
 {const {context,page}=await setup(browser,{signedIn:false});for(const width of [1440,375]){await page.setViewportSize({width,height:900});await page.goto(base()+'/#/login');await page.waitForTimeout(150);record(await page.evaluate(scanner),'auth@'+width);
   const forgot=page.locator('#cp-forgot-password');if(await forgot.count()){await forgot.click();await page.waitForTimeout(80);record(await page.evaluate(scanner),'forgot@'+width);}}await context.close();}
 const f=[...fails.values()].sort((a,b)=>a.ratio-b.ratio);
 console.log(JSON.stringify({scannedTextNodes:scanned,contrastFailures:f.length,failures:f.map(x=>({sel:x.sel,text:x.text,fg:x.fg,bg:x.bg,ratio:x.ratio,need:x.need,size:x.size,views:[...x.views].slice(0,3)})),textUnder12px:[...small.values()].map(x=>({sel:x.sel,size:x.size,text:x.text,views:[...x.views].slice(0,2)}))},null,1));
 return f.length;
}
async function shots(browser){
 fs.mkdirSync(outDir,{recursive:true});const {context,page}=await setup(browser,{longNames:true});await page.goto(base()+'/#/dashboard');await page.locator('#noticeBell').waitFor();
 for(const width of [320,414,768,1024,1440]){await page.setViewportSize({width,height:900});for(const v of APP){await go(page,'/'+v,80);await page.screenshot({path:path.join(outDir,v+'-'+width+'.png'),fullPage:true});}}
 for(const route of ['privacy','account']){await page.setViewportSize({width:414,height:900});await page.goto(base()+'/#/'+route);await page.waitForTimeout(100);await page.screenshot({path:path.join(outDir,route+'-414.png'),fullPage:true});}
 await context.close();console.log('screenshots written to',outDir);
}
async function responsive(browser){
 const results={widths:0,zoom:[],forcedColors:[],keyboard:[],fonts:{}};
 const widths=[320,360,375,390,414,430,600,768,820,1024,1280,1440,1920,2560];
 const {context,page}=await setup(browser,{longNames:true});await page.goto(base()+'/#/dashboard');await page.locator('#noticeBell').waitFor();
 const overflow=()=>page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 for(const width of widths){await page.setViewportSize({width,height:900});for(const v of APP){await go(page,'/'+v,35);const o=await overflow();if(o.scroll>o.client)throw Error(`overflow ${width} ${v} ${JSON.stringify(o)}`);results.widths++;}}
 // Browser zoom 200%/400% is equivalent to a viewport of width/zoom CSS px at the same device size (WCAG 1.4.4/1.4.10 reflow).
 for(const [zoom,base_w] of [[2,1280],[4,1280],[2,1920],[4,1920]]){const w=Math.round(base_w/zoom);await page.setViewportSize({width:w,height:Math.round(900/zoom)});
  for(const v of APP){await go(page,'/'+v,35);const o=await overflow();if(o.scroll>o.client)throw Error(`zoom ${zoom*100}% (${w}px) overflow ${v} ${JSON.stringify(o)}`);}results.zoom.push(`${zoom*100}% of ${base_w}px => ${w}px viewport: no horizontal scroll on ${APP.length} views`);}
 // Text-size-only zoom: root font 200% must not clip or scroll horizontally (WCAG 1.4.4).
 await page.setViewportSize({width:1280,height:900});await page.addStyleTag({content:'html{font-size:200%!important}'});
 for(const v of APP){await go(page,'/'+v,35);const o=await overflow();if(o.scroll>o.client)throw Error(`text-zoom overflow ${v}`);}
 results.zoom.push('root text size 200%: no horizontal scroll on '+APP.length+' views');await page.reload();
 await context.close();
 // forced colors + reduced motion
 const fc=await browser.newContext({forcedColors:'active',reducedMotion:'reduce'}),fp=await fc.newPage();
 await fp.route('**/api/**',async r=>{const u=new URL(r.request().url());const d={'/api/session':{user:{userId:'qa-a',email:'q@example.invalid',name:'QA',emailVerified:true,legacyAccess:false}},'/api/workspace':{exists:true,state,revision:0,role:'owner',shared:false,archived:false,profileNames:{a:'A',b:'B'}},'/api/profile':{displayName:'QA',avatarColor:'teal',customized:false},'/api/notifications':{revision:0,items:[],unread:0,pending:0,pendingAmount:0,awaiting:0,awaitingAmount:0}}[u.pathname]||{};await r.fulfill({json:d});});
 await fp.setViewportSize({width:1280,height:900});await fp.goto(base()+'/#/dashboard');await fp.locator('#noticeBell').waitFor();
 results.forcedColors.push(await fp.evaluate(()=>({forcedColorsMatches:matchMedia('(forced-colors: active)').matches,reducedMotionMatches:matchMedia('(prefers-reduced-motion: reduce)').matches})));
 for(const v of APP){await go(fp,'/'+v,35);const bad=await fp.evaluate(()=>[...document.querySelectorAll('button,a[href],input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();if(r.width<1)return false;const cs=getComputedStyle(e);return cs.borderStyle==='none'&&cs.outlineStyle==='none'&&cs.boxShadow==='none'&&cs.backgroundColor==='rgba(0, 0, 0, 0)';}).length);results.forcedColors.push({view:v,controlsWithNoBorderOutlineOrFill:bad});}
 // Animations/transitions must be effectively disabled under reduce.
 results.reducedMotion=await fp.evaluate(()=>{const d=[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e);return (parseFloat(s.transitionDuration)>0.001)||(s.animationName!=='none'&&parseFloat(s.animationDuration)>0.001);}).length;return {elementsStillAnimating:d,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior};});
 await fc.close();
 // keyboard: every interactive control reachable by Tab has a visible focus indicator and is not 0x0
 // keyboard: every interactive control reachable by Tab has a visible focus indicator and is not obscured
 const kc=await browser.newContext(),kp=await kc.newPage();
 await kp.route('**/api/**',async r=>{const u=new URL(r.request().url());const d={'/api/session':{user:{userId:'qa-a',email:'q@example.invalid',name:'QA',emailVerified:true,legacyAccess:false}},'/api/workspace':{exists:true,state,revision:0,role:'owner',shared:false,archived:false,profileNames:{a:'A',b:'B'}},'/api/profile':{displayName:'QA',avatarColor:'teal',customized:false},'/api/account':{emailVerified:true,legacyAccess:false,emailDeliveryConfigured:false,deletionRequest:null},'/api/notifications':{revision:0,items:[],unread:0,pending:0,pendingAmount:0,awaiting:0,awaitingAmount:0}}[u.pathname]||{};await r.fulfill({json:d});});
 for(const width of [1280,375]){await kp.setViewportSize({width,height:900});await kp.goto(base()+'/#/dashboard');await kp.locator('#noticeBell').waitFor();
  for(const v of ['dashboard','expenses','settings','addExpense']){await go(kp,'/'+v,60);await kp.evaluate(()=>document.activeElement&&document.activeElement.blur());
   const seen=new Set();let noIndicator=[];
   for(let i=0;i<60;i++){await kp.keyboard.press('Tab');const info=await kp.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const cs=getComputedStyle(e),r=e.getBoundingClientRect();return {id:e.tagName+'#'+(e.id||e.className||e.textContent.trim().slice(0,12)),outline:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>=2,shadow:cs.boxShadow!=='none',border:cs.borderColor,visible:r.width>0&&r.height>0,obscured:(()=>{const x=r.left+r.width/2,y=r.top+r.height/2;const t=document.elementFromPoint(x,y);return !!t&&!e.contains(t)&&!t.contains(e);})()};});
    if(!info)continue;if(seen.has(info.id))break;seen.add(info.id);if(!(info.outline||info.shadow))noIndicator.push(info.id);if(info.obscured)noIndicator.push('OBSCURED '+info.id);}
   results.keyboard.push({width,view:v,tabStops:seen.size,withoutVisibleIndicatorOrObscured:noIndicator});}}
 await kc.close();
 console.log(JSON.stringify(results,null,1));
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{if(mode==='contrast')await contrast(browser);else if(mode==='shots')await shots(browser);else if(mode==='responsive')await responsive(browser);else throw Error('unknown mode');}
 catch(e){console.error('FAIL:',e.message);process.exitCode=1;}finally{await browser.close();server.close();const {pool}=require('../server/index.cjs');await pool.end().catch(()=>{});}
})();
