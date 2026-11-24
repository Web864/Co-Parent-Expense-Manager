'use strict';
const crypto=require('node:crypto'),{performance}=require('node:perf_hooks'),{hashPassword}=require('../server/security.cjs');
async function measure(kind){let last=performance.now(),gap=0;const timer=setInterval(()=>{const n=performance.now();gap=Math.max(gap,n-last);last=n;},1);await new Promise(r=>setTimeout(r,5));const start=performance.now();const value=crypto.randomBytes(24).toString('hex');
 if(kind==='sync')for(let i=0;i<8;i++)crypto.scryptSync(value,'benchmark-only-salt',64,{N:32768,r:8,p:3,maxmem:64*1024*1024});else await Promise.all(Array.from({length:8},()=>hashPassword(value)));
 const elapsed=performance.now()-start;await new Promise(r=>setTimeout(r,10));clearInterval(timer);return {hashes:8,elapsedMs:Math.round(elapsed),maxHeartbeatGapMs:Math.round(gap)};}
(async()=>console.log(JSON.stringify({sync:await measure('sync'),async:await measure('async'),note:'Local synthetic capacity comparison, not production load certification.'},null,2)))();
