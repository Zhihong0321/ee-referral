const API_KEY = "sk-dc93b975fa674e830836ad82686e17bfe1b2b2c69fbe4fa0d5c676d5d31ada18";

async function testModel(modelName) {
  console.log(`\n--- Testing model: ${modelName} on https://api.apikey.fun/v1/messages ---`);
  try {
    const res = await fetch("https://api.apikey.fun/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "authorization": `Bearer ${API_KEY}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 200,
        messages: [{ role: "user", content: "Hello, reply with OK" }],
      }),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text.slice(0, 400)}`);
  } catch (e) {
    console.error(`Error:`, e.message);
  }
}

async function run() {
  const models = [
    "mimo-v2.5-pro",
    "MiniMax-M3",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
    "gpt-4o",
    "gpt-4o-mini",
    "deepseek-chat"
  ];
  for (const m of models) {
    await testModel(m);
  }
}

run();
