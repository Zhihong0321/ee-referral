const endpoints = [
  "https://api.apikey.fun/v1/messages",
  "https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages",
  "https://api.minimax.io/anthropic/v1/messages",
  "https://api.uniapi.io/v1/messages",
  "https://api.uniapi.io/gemini/v1beta/models/gemini-1.5-flash:generateContent"
];

async function checkEndpoint(url) {
  console.log(`\nTesting 401 on: ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": "invalid-key-test",
        "authorization": "Bearer invalid-key-test",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "test", messages: [] })
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Body: ${text}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }
}

async function run() {
  for (const url of endpoints) {
    await checkEndpoint(url);
  }
}

run();
