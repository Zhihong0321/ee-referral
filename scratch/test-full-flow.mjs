const API_KEY = "sk-dc93b975fa674e830836ad82686e17bfe1b2b2c69fbe4fa0d5c676d5d31ada18";
const BASE_URL = "https://api.apikey.fun/v1";
const MODEL = "mimo-v2.5-pro";

function getLlmEndpoint(baseUrl) {
  const clean = baseUrl.replace(/\/$/, "");
  if (clean.endsWith("/messages")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/anthropic/v1/messages`;
}

async function testFullCall() {
  const endpoint = getLlmEndpoint(BASE_URL);
  console.log(`Endpoint: ${endpoint}`);

  const tools = [
    {
      name: "get_lead_status",
      description: "Get the status of a lead by phone number or name",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Phone number or name" },
        },
        required: ["query"],
      },
    },
  ];

  const body = {
    model: MODEL,
    max_tokens: 800,
    system: "You are an AI Referral Assistant. Use tools when appropriate.",
    messages: [
      { role: "user", content: "Check status for lead 0123888777" },
    ],
    tools,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "authorization": `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`Status: ${response.status}`);
  console.log(`Raw Body:`, text);

  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  console.log(`Parsed content blocks:`, JSON.stringify(payload.content, null, 2));
}

testFullCall();
