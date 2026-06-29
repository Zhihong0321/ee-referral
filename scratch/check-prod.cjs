/* eslint-disable */
const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:tkaYtCcfkqfsWKjQguFMqIcANbJNcNZA@shinkansen.proxy.rlwy.net:34999/railway' });
async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT id, channel_type, session_identifier, updated_at, 
           jsonb_array_length(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) as log_count,
           metadata->'agentDebugLog'->-1 as last_log
    FROM et_channel_sessions 
    WHERE channel_type = 'whatsapp' 
    ORDER BY updated_at DESC LIMIT 1
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);

