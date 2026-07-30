export type ActivityLogActor = {
  kind: string;
  userId?: number | null;
  ref?: string | null;
  name?: string | null;
  role?: string | null;
};

export type ActivityLogEntry = {
  action: "create" | "update" | "delete";
  actor: ActivityLogActor;
  entityId: string | number;
  entityLabel?: string | null;
  description: string;
  fields?: string[];
  metadata?: Record<string, unknown>;
  sourceUrl?: string | null;
  status?: "success" | "failed";
  errorMessage?: string | null;
  requestId?: string | null;
};

export type ActivityLogExecutor = (text: string, params?: unknown[]) => Promise<unknown>;

const APP_NAME = "ee-referral";

function getAppEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

export async function writeActivityLog(execute: ActivityLogExecutor, entry: ActivityLogEntry) {
  await execute(
    `
      INSERT INTO activity_log (
        app,
        app_env,
        source_url,
        actor_kind,
        actor_user_id,
        actor_ref,
        actor_name,
        actor_role,
        action,
        entity_type,
        entity_id,
        entity_label,
        description,
        fields,
        status,
        error_message,
        request_id,
        metadata,
        occurred_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'referral', $10, $11, $12,
        $13::text[], $14, $15, $16, $17::jsonb, NOW()
      )
    `,
    [
      APP_NAME,
      getAppEnvironment(),
      entry.sourceUrl || null,
      entry.actor.kind,
      entry.actor.userId || null,
      entry.actor.ref || null,
      entry.actor.name || null,
      entry.actor.role || null,
      entry.action,
      String(entry.entityId),
      entry.entityLabel || null,
      entry.description,
      entry.fields || [],
      entry.status || "success",
      entry.errorMessage || null,
      entry.requestId || null,
      JSON.stringify(entry.metadata || {}),
    ],
  );
}
