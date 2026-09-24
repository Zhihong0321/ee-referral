const API_KEY = "sk-dc93b975fa674e830836ad82686e17bfe1b2b2c69fbe4fa0d5c676d5d31ada18";

async function testHeaders(label, headers, body) {
  console.log(`\n--- ${label} ---`);
  try {
    const res = await fetch("https://api.apikey.fun/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text.slice(0, 300)}`);
  } catch (e) {
    console.error(`Error:`, e.message);
  }
}

async function run() {
  const body = {
    model: "mimo-v2.5-pro",
    max_tokens: 100,
    messages: [{ role: "user", content: "hi" }],
  };

  // Test 1: all headers (as in whatsapp-flow-v2.ts)
  await testHeaders("Test 1: authorization + x-api-key + api-key", {
    "authorization": `Bearer ${API_KEY}`,
    "x-api-key": API_KEY,
    "api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, body);

  // Test 2: only x-api-key
  await testHeaders("Test 2: only x-api-key", {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, body);

  // Test 3: only authorization Bearer
  await testHeaders("Test 3: only Authorization Bearer", {
    "authorization": `Bearer ${API_KEY}`,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, body);

  // Test 4: with MiniMax-M3 model
  await testHeaders("Test 4: MiniMax-M3 model", {
    "authorization": `Bearer ${API_KEY}`,
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, {
    model: "MiniMax-M3",
    max_tokens: 100,
    messages: [{ role: "user", content: "hi" }],
  });

  // Test 5: invalid key format check
  await testHeaders("Test 5: Dummy invalid key", {
    "authorization": `Bearer invalid-key`,
    "x-api-key": "invalid-key",
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, body);
}

run();
