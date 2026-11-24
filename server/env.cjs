'use strict';
const fs=require('node:fs'),path=require('node:path');
function loadEnv(){const file=path.join(__dirname,'../.env');for(const line of (fs.existsSync(file)?fs.readFileSync(file,'utf8'):'').split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}return process.env;}
module.exports={loadEnv};
