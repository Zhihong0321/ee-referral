import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8"); const cfg={};
for(const l of env.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)cfg[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}
const url=cfg.WHATSAPP_AGENT_PROXY_URL, auth=cfg.WHATSAPP_AGENT_PROXY_AUTH, db=cfg.WHATSAPP_AGENT_PROXY_DB_NAME;
async function q(sql,params=[]){const r=await fetch(url.replace(/\/$/,"")+"/api/sql",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({db_name:db,sql,params})});const t=await r.text();const j=JSON.parse(t);if(!r.ok||j.error)throw new Error(j.error||t);return j.rows||[];}

// BEFORE: which sales users will be patched (name null/blank + linked agent has a name)
const before = await q(`
  SELECT u.id, u.email, a.name AS agent_name
  FROM "user" u
  JOIN agent a ON u.linked_agent_profile = a.bubble_id
  WHERE (u.name IS NULL OR BTRIM(u.name) = '')
    AND BTRIM(COALESCE(a.name,'')) <> ''
  ORDER BY u.id`);
console.log("WILL PATCH (" + before.length + "):");
console.log(JSON.stringify(before, null, 2));
