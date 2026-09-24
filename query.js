// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.WHATSAPP_AGENT_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eternalgy' });
pool.query("SELECT metadata FROM et_channel_sessions WHERE session_identifier = '60182220099'").then(res => {
  console.log(JSON.stringify((res.rows[0]?.metadata?.agentDebugLog || []).slice(-5), null, 2));
  pool.end();
}).catch(console.error);
