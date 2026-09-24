import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8"); const cfg={};
for(const l of env.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)cfg[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}
const url=cfg.WHATSAPP_AGENT_PROXY_URL, auth=cfg.WHATSAPP_AGENT_PROXY_AUTH, db=cfg.WHATSAPP_AGENT_PROXY_DB_NAME;
async function q(sql,params=[]){const r=await fetch(url.replace(/\/$/,"")+"/api/sql",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({db_name:db,sql,params})});const j=JSON.parse(await r.text());if(!r.ok||j.error)throw new Error(j.error);return j.rows||[];}
const agentCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent' ORDER BY ordinal_position`);
console.log("AGENT COLUMNS:", agentCols.map(c=>c.column_name).join(", "));
const a = await q(`SELECT * FROM agent WHERE bubble_id=$1`, ["agent_c0589e38e510c995"]);
const r=a[0]||{}; const nn={}; for(const k in r){ if(r[k]!==null&&r[k]!=="") nn[k]=r[k]; }
console.log("LINKED AGENT PROFILE (non-null):", JSON.stringify(nn,null,2));
