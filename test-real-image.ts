async function testRealImage() {
  const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/8/8b/Business_Card_-_G._A._Rentschler_%2810313837905%29.jpg";
  const imageResponse = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const arrayBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = "image/jpeg";

  const apiKey = process.env.AI_API_KEY || "";
  const baseUrl = process.env.AI_BASE_URL || "";
  const model = process.env.AI_MODEL || "";
  if (!apiKey || !baseUrl || !model) throw new Error("AI_API_KEY, AI_BASE_URL, and AI_MODEL are required.");

  const promptText = "Convert this WhatsApp image into plain text for a referral assistant.";

  console.log(`Testing real image size: ${base64Image.length} chars`);
  const startTime = performance.now();
  
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
      })
    });

    const text = await response.text();
    const endTime = performance.now();
    const timeSecs = ((endTime - startTime) / 1000).toFixed(2);

    if (!response.ok) {
      console.error(`Failed (${timeSecs}s) - HTTP ${response.status}:`, text);
    } else {
      console.log(`Success (${timeSecs}s) - Output:`, text.slice(0, 200));
    }
  } catch (error) {
    console.error(`Fetch error:`, error);
  }
}

testRealImage();
