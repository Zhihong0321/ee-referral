/* eslint-disable */
const { Client } = require("pg");

const connectionString =
  process.env.PROD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:tkaYtCcfkqfsWKjQguFMqIcANbJNcNZA@shinkansen.proxy.rlwy.net:34999/railway";

function preview(value, length = 220) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").slice(0, length);
}

async function query(client, label, sql, params = []) {
  const result = await client.query(sql, params);
  console.log(`\n## ${label}`);
  console.log(JSON.stringify(result.rows, null, 2));
}

async function run() {
  const client = new Client({ connectionString });
  await client.connect();
  const targetPhone = process.argv[2];

  await query(client, "clock", "SELECT NOW()::text AS db_now");

  if (targetPhone) {
    const cleanPhone = targetPhone.replace(/^0|^60|\D/g, '');
    const canonicalPhone = `60${cleanPhone}`;
    
    await query(
      client,
      `debug_state_for_${canonicalPhone}`,
      `
        SELECT 
          jsonb_pretty(COALESCE(metadata->'agentStates'->'${canonicalPhone}', '{}'::jsonb)) AS current_state,
          (
            SELECT jsonb_pretty(jsonb_agg(entry))
            FROM jsonb_array_elements(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) AS entry
            WHERE entry->>'phone' LIKE '%${cleanPhone}%'
          ) AS full_debug_log
        FROM et_channel_sessions
        WHERE channel_type = 'whatsapp'
        LIMIT 1
      `
    );

    await query(
      client,
      `recent_messages_for_${canonicalPhone}`,
      `
        SELECT
          id::text,
          direction,
          message_type,
          left(COALESCE(text_content, ''), 220) AS text_content,
          created_at::text
        FROM et_messages
        WHERE channel = 'whatsapp' 
          AND (sender_phone LIKE '%${cleanPhone}%' OR recipient_phone LIKE '%${cleanPhone}%')
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 20
      `
    );
    
    await client.end();
    return;
  }

  await query(
    client,
    "last_whatsapp_messages",
    `
      SELECT
        id::text,
        external_message_id,
        direction,
        message_type,
        sender_phone,
        recipient_phone,
        left(COALESCE(text_content, ''), 220) AS text_content,
        delivery_status,
        created_at::text
      FROM et_messages
      WHERE channel = 'whatsapp'
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 30
    `,
  );

  await query(
    client,
    "unreplied_inbound_24h",
    `
      SELECT
        inbound.id::text,
        inbound.external_message_id,
        inbound.message_type,
        inbound.sender_phone,
        inbound.recipient_phone,
        left(COALESCE(inbound.text_content, ''), 220) AS text_content,
        inbound.created_at::text
      FROM et_messages inbound
      WHERE inbound.channel = 'whatsapp'
        AND inbound.direction = 'inbound'
        AND inbound.sender_phone IS NOT NULL
        AND BTRIM(inbound.sender_phone) <> ''
        AND (inbound.recipient_phone IS NULL OR inbound.sender_phone <> inbound.recipient_phone)
        AND inbound.external_message_id IS NOT NULL
        AND BTRIM(inbound.external_message_id) <> ''
        AND inbound.created_at >= NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1
          FROM et_messages outbound
          WHERE outbound.channel = 'whatsapp'
            AND outbound.direction = 'outbound'
            AND outbound.external_message_id = 'agent_reply_' || inbound.external_message_id
        )
      ORDER BY inbound.created_at DESC NULLS LAST, inbound.id DESC
      LIMIT 30
    `,
  );

  await query(
    client,
    "message_counts",
    `
      SELECT
        COUNT(*) FILTER (WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '1 hour') AS inbound_1h,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND created_at >= NOW() - INTERVAL '1 hour') AS outbound_1h,
        COUNT(*) FILTER (WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '24 hours') AS inbound_24h,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND created_at >= NOW() - INTERVAL '24 hours') AS outbound_24h,
        MAX(created_at)::text FILTER (WHERE direction = 'inbound') AS last_inbound_at,
        MAX(created_at)::text FILTER (WHERE direction = 'outbound') AS last_outbound_at
      FROM et_messages
      WHERE channel = 'whatsapp'
    `,
  );

  await query(
    client,
    "agent_debug_log_tail",
    `
      SELECT
        session_identifier,
        updated_at::text,
        jsonb_array_length(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) AS log_count,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'at', entry->>'at',
            'phone', entry->>'phone',
            'inbound', left(COALESCE(entry->>'inbound', ''), 220),
            'reply', left(COALESCE(entry->>'reply', ''), 220),
            'wrote', entry->>'wrote',
            'toolCalls', entry->'toolCalls',
            'fallbackUsed', entry->>'fallbackUsed',
            'ms', entry->>'ms'
          ) ORDER BY ord DESC)
          FROM jsonb_array_elements(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) WITH ORDINALITY AS t(entry, ord)
          WHERE ord > GREATEST(jsonb_array_length(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) - 10, 0)
        ) AS tail
      FROM et_channel_sessions
      WHERE channel_type = 'whatsapp'
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 3
    `,
  );

  await query(
    client,
    "inbox_tail",
    `
      SELECT
        id::text,
        session_identifier,
        external_message_id,
        sender_phone,
        recipient_phone,
        message_type,
        process_status,
        process_attempts,
        left(COALESCE(last_error, ''), 220) AS last_error,
        created_at::text,
        updated_at::text
      FROM wa_inbound_inbox
      ORDER BY created_at DESC NULLS LAST
      LIMIT 20
    `,
  );

  await client.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

