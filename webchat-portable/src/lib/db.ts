import { Pool, type QueryResultRow } from "pg";

import { getEnv } from "@/lib/env";

declare global {
  var __eeReferralPool: Pool | undefined;
}

function createPool() {
  const env = getEnv();

  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

export function getPool() {
  if (!global.__eeReferralPool) {
    global.__eeReferralPool = createPool();
  }

  return global.__eeReferralPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params);
}
