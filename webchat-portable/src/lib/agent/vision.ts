export async function convertVisualBytesToText(input: {
  contentType: string;
  base64: string;
  messageType: "image" | "video";
  caption: string;
}) {
  const { contentType, base64: mediaBase64, messageType, caption } = input;
  const apiKey = process.env.WHATSAPP_AGENT_VISION_API_KEY || "";
  if (!apiKey) {
    throw new Error("Vision API key is not set.");
  }

  const baseUrl = (process.env.WHATSAPP_AGENT_VISION_BASE_URL || "https://api.apikey.fun/v1").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Vision API base URL is not set.");
  }

  const model = process.env.WHATSAPP_AGENT_VISION_MODEL || "gpt-5.4-mini";
  const promptText = [
    `Convert this WhatsApp ${messageType} into plain text for a referral assistant.`,
    "Look specifically for referral contact details in name cards, business cards, handwritten notes, forms, screenshots, posters, chat screenshots, and cropped photos.",
    "OCR all visible text that may be a person name, company name, phone/mobile/WhatsApp number, location/area, address, or instruction such as call/contact/pass to/assign/PIC/preferred agent.",
    "Phone extraction is highest priority. Preserve country codes and leading zeroes. If multiple phone numbers are visible, list all of them and label the most likely lead phone if clear.",
    "Name extraction is second priority. Include names from handwritten text, name-card titles, contact screenshots, and labels near phone numbers. Keep Chinese, Malay, and English names exactly as visible.",
    "Area/location extraction is third priority. Include township, city, state, project/site area, or address if visible.",
    "Preferred-agent extraction is fourth priority. Only include it if the image/caption clearly indicates an agent/PIC/handler.",
    "Return only referral-relevant details in plain text using this format when possible: Lead name: ... | Lead phone: ... | Area: ... | Preferred agent: ... | Notes: ...",
    "If no referral lead details are visible, return exactly: No referral lead details visible.",
    caption ? `Caption: ${caption}` : "",
  ].filter(Boolean).join("\n");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60_000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              {
                type: "image_url",
                image_url: {
                  url: `data:${contentType};base64,${mediaBase64}`,
                },
              },
            ],
          },
        ],
      }),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Vision API failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const converted = payload.choices?.[0]?.message?.content?.trim() || "";
    if (converted) return converted;
    throw new Error("Vision API returned empty text.");
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Vision API timed out after 60 seconds.");
    }
    throw error;
  }
}
