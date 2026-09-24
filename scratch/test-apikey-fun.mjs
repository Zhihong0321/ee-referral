const API_KEY = "sk-dc93b975fa674e830836ad82686e17bfe1b2b2c69fbe4fa0d5c676d5d31ada18";

async function testEndpoint(url, headers, body) {
  console.log(`\nTesting POST ${url}...`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const status = res.status;
    const text = await res.text();
    console.log(`Status: ${status}`);
    console.log(`Response: ${text.slice(0, 500)}`);
  } catch (err) {
    console.error(`Fetch error:`, err.message);
  }
}

async function run() {
  // Test Anthropic Messages format 1: https://api.apikey.fun/v1/messages
  await testEndpoint(
    "https://api.apikey.fun/v1/messages",
    {
      "x-api-key": API_KEY,
      "authorization": `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello" }],
    }
  );

  // Test Anthropic Messages format 2: https://api.apikey.fun/v1/anthropic/v1/messages
  await testEndpoint(
    "https://api.apikey.fun/v1/anthropic/v1/messages",
    {
      "x-api-key": API_KEY,
      "authorization": `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello" }],
    }
  );

  // Test Anthropic Messages format 3: https://api.apikey.fun/anthropic/v1/messages
  await testEndpoint(
    "https://api.apikey.fun/anthropic/v1/messages",
    {
      "x-api-key": API_KEY,
      "authorization": `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello" }],
    }
  );

  // Test OpenAI format: https://api.apikey.fun/v1/chat/completions
  await testEndpoint(
    "https://api.apikey.fun/v1/chat/completions",
    {
      "authorization": `Bearer ${API_KEY}`,
      "content-type": "application/json",
    },
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hello" }],
    }
  );
}

run();
