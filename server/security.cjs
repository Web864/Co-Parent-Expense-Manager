'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const passwordValid=p=>typeof p==='string'&&p.length>=10&&p.length<=128;
const currentParams={N:32768,r:8,p:3,maxmem:64*1024*1024};
const legacyParams={N:16384,r:8,p:1,maxmem:64*1024*1024};
async function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
 return 'scrypt:32768:8:3:'+salt+':'+(await scrypt(password,salt,64,currentParams)).toString('hex');
}
async function passwordMatches(password,stored){
 const legacy=typeof stored==='string'&&stored.match(/^([a-f0-9]{32}):([a-f0-9]{128})$/);
 const current=typeof stored==='string'&&stored.match(/^scrypt:32768:8:3:([a-f0-9]{32}):([a-f0-9]{128})$/);
 const zero='0'.repeat(32);
 // Equal derivation work for current, legacy and unknown accounts; no arbitrary stored work factors.
 const [modern,older]=await Promise.all([scrypt(password,current?current[1]:zero,64,currentParams),scrypt(password,legacy?legacy[1]:zero,64,legacyParams)]);
 const expected=Buffer.from(current?current[2]:legacy?legacy[2]:'00'.repeat(64),'hex');
 return crypto.timingSafeEqual(expected,legacy?older:modern)&&!!(legacy||current);
}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function createLimiter(pool){return async function limit(action,identity,max,seconds){
 const key=sha(action+':'+identity);
 const {rows}=await pool.query(`INSERT INTO cp_rate_limits(key,attempts,expires_at) VALUES($1,1,now()+$2*interval '1 second')
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN cp_rate_limits.expires_at<=now() THEN 1 ELSE cp_rate_limits.attempts+1 END,
 expires_at=CASE WHEN cp_rate_limits.expires_at<=now() THEN now()+$2*interval '1 second' ELSE cp_rate_limits.expires_at END RETURNING attempts`,[key,seconds]);
 if(rows[0].attempts>max){const e=new Error('Too many attempts. Please try again later.');e.status=429;throw e;}
};}
module.exports={hashPassword,passwordMatches,passwordValid,sha,createLimiter};
