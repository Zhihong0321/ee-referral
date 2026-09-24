/**
 * Environment bootstrap for the reasoning harness.
 *
 * Loads .env.local (same values Next uses), then applies HARD SAFETY
 * overrides: the Baileys base URL is force-blanked so no code path can send
 * a WhatsApp message, no matter what the env file says. Agent-notification
 * attempts fail soft inside whatsapp-data (caught, reported as reason).
 *
 * AI PROVIDER OVERRIDE: this harness deliberately points at the Xiaomi MiMo
 * token-plan endpoint (vault id "mimo-0730") through the same OpenAI-compatible
 * configuration used in production. Results reflect the shared tool/prompt
 * scaffolding rather than a benchmark of the production model.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MIMO_BASE_URL = "https://token-plan-sgp.xiaomimimo.com";
const MIMO_MODEL = "mimo-v2.5-pro";
const MIMO_VAULT_ID = "mimo-0730";

// This project's LLM vars must win even if the OS/shell already exports
// same-named vars for an unrelated tool (e.g. the mmx-cli skill sets its own
// AI_API_KEY globally on this machine) — otherwise the harness silently
// authenticates against the wrong account/model.
const FORCE_FROM_ENV_FILE = new Set(["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"]);

export function loadEnv(rootDir) {
  const envFile = path.join(rootDir, ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined || FORCE_FROM_ENV_FILE.has(m[1])) process.env[m[1]] = value;
    }
  }

  // ---- SAFETY: unplug WhatsApp completely -------------------------------
  process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL = "";

  // ---- LLM provider override: Xiaomi MiMo token plan, from Hermes vault --
  const vaultPath = path.join(os.homedir(), ".hermes", "vault.json");
  let vault;
  try {
    vault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
  } catch {
    throw new Error(`Cannot read Hermes vault at ${vaultPath} — needed for the MiMo token-plan key.`);
  }
  const mimoCred = vault.credentials?.find((c) => c.id === MIMO_VAULT_ID);
  if (!mimoCred?.credential) {
    throw new Error(`Vault credential "${MIMO_VAULT_ID}" not found. Run vault_service.py to add/sync it.`);
  }

  process.env.AI_API_KEY = mimoCred.credential;
  process.env.AI_BASE_URL = MIMO_BASE_URL;
  process.env.AI_MODEL = MIMO_MODEL;
}
