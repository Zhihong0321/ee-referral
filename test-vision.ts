async function testVision() {
  // Use a tiny 1x1 PNG or a small real valid base64 image
  // This is a 1x1 black PNG
  const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const mimeType = "image/png";

  const apiKey = process.env.AI_API_KEY || "";
  const baseUrl = process.env.AI_BASE_URL || "";
  const model = process.env.AI_MODEL || "";
  if (!apiKey || !baseUrl || !model) throw new Error("AI_API_KEY, AI_BASE_URL, and AI_MODEL are required.");

  const promptText = "Convert this WhatsApp image into plain text for a referral assistant.";

  console.log(`Running 5 iterations to test failure rate...`);
  for (let i = 1; i <= 5; i++) {
    const startTime = performance.now();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000); // 15 seconds timeout
    
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        }),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        [key: string]: unknown;
      };
      const endTime = performance.now();
      const timeSecs = ((endTime - startTime) / 1000).toFixed(2);

      if (!response.ok) {
        console.error(`[Run ${i}] Failed (${timeSecs}s) - HTTP ${response.status}:`, JSON.stringify(data).slice(0, 300));
      } else {
        const converted = data.choices?.[0]?.message?.content?.trim() || "";
        console.log(`[Run ${i}] Success (${timeSecs}s) - Output length: ${converted.length}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const endTime = performance.now();
      const timeSecs = ((endTime - startTime) / 1000).toFixed(2);
      if (error instanceof Error && error.name === "AbortError") {
        console.error(`[Run ${i}] Failed (${timeSecs}s) - TIMEOUT`);
      } else {
        console.error(`[Run ${i}] Failed (${timeSecs}s) - ERROR:`, error);
      }
    }
  }
}

testVision();
