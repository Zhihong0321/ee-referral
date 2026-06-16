const appUrl = (process.env.APP_BASE_URL || process.argv[2] || "").replace(/\/$/, "");

if (!appUrl) {
  console.error("Usage: node scripts/probe-whatsapp-agent.mjs https://your-app-url");
  process.exit(1);
}

const response = await fetch(`${appUrl}/api/whatsapp-agent/diagnostics`, { cache: "no-store" });
const text = await response.text();

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error(text);
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
process.exit(response.ok && payload.ok ? 0 : 1);
