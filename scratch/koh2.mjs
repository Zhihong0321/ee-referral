import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8"); const cfg={};
for(const l of env.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)cfg[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}
const url=cfg.WHATSAPP_AGENT_PROXY_URL||cfg.SANDBOX_PROXY_URL, auth=cfg.WHATSAPP_AGENT_PROXY_AUTH||cfg.SANDBOX_PROXY_AUTH, db=cfg.WHATSAPP_AGENT_PROXY_DB_NAME||cfg.SANDBOX_PROXY_DB_NAME;
async function q(sql,params=[]){const r=await fetch(url.replace(/\/$/,"")+"/api/sql",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({db_name:db,sql,params})});const t=await r.text();const j=JSON.parse(t);if(!r.ok||j.error)throw new Error(j.error||t);return j.rows||[];}

// Search user table by email/contact for yijaykoh
const byEmail = await q(`SELECT id,name,email,access_level,contact FROM "user" WHERE LOWER(email) LIKE $1 OR contact LIKE $2 OR LOWER(name) LIKE $3`, ["%yijay%","%1153419315%","%yi jay%"]);
console.log("USER by email/contact/name:", JSON.stringify(byEmail,null,2));

// What tables have a column mentioning yijay-like data? List tables that look agent/user related.
const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%user%' OR table_name ILIKE '%agent%' OR table_name ILIKE '%staff%' OR table_name ILIKE '%member%') ORDER BY table_name`);
console.log("CANDIDATE TABLES:", JSON.stringify(tables.map(t=>t.table_name)));
