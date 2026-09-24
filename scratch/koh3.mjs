import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8"); const cfg={};
for(const l of env.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)cfg[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}
const url=cfg.WHATSAPP_AGENT_PROXY_URL, auth=cfg.WHATSAPP_AGENT_PROXY_AUTH, db=cfg.WHATSAPP_AGENT_PROXY_DB_NAME;
async function q(sql,params=[]){const r=await fetch(url.replace(/\/$/,"")+"/api/sql",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({db_name:db,sql,params})});const j=JSON.parse(await r.text());if(!r.ok||j.error)throw new Error(j.error);return j.rows||[];}
// full row for 7172 (all columns)
const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user' ORDER BY ordinal_position`);
console.log("USER COLUMNS:", cols.map(c=>c.column_name).join(", "));
const row = await q(`SELECT * FROM "user" WHERE id=7172`);
// print only non-null fields to keep it readable
const r=row[0]; const nonNull={}; for(const k in r){ if(r[k]!==null && r[k]!=="") nonNull[k]=r[k]; }
console.log("ROW 7172 (non-null fields):", JSON.stringify(nonNull,null,2));
// how many sales users have NULL/blank name?
const cnt = await q(`SELECT COUNT(*)::int AS n FROM "user" u WHERE (u.name IS NULL OR BTRIM(u.name)='') AND EXISTS(SELECT 1 FROM unnest(u.access_level) x WHERE LOWER(x) LIKE '%sales%')`);
console.log("SALES USERS WITH NULL/BLANK NAME:", cnt[0].n);
