import { NextResponse } from "next/server";
import { z } from "zod";

import { appendConversation } from "@/lib/agent/whatsapp-data";
import { convertVisualBytesToText } from "@/lib/agent/whatsapp-processor";
import { runWebchatMenuTurn } from "@/lib/agent/webchat-flow";
import { logWebchatExchange } from "@/lib/agent/webchat-transcript";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const requestSchema = z
  .object({
    phone: z.string().trim().min(1).max(30),
    message: z.string().trim().max(2000).default(""),
    image: z
      .object({
        dataUrl: z.string().trim().min(1),
      })
      .optional(),
  })
  .refine((data) => data.message.length > 0 || data.image, {
    message: "Type a message or attach an image.",
  });

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;

  const [, contentType, base64] = match;
  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength === 0 || byteLength > MAX_IMAGE_BYTES) return null;

  return { contentType, base64 };
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(body.data.phone);

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please log in with a valid phone number first." }, { status: 400 });
  }

  const caption = body.data.message;
  // The flow is a deterministic menu with no model behind it, so an image is
  // only ever transcribed for the record — its text must not be fed to the step
  // parser, which would read it as an answer to whatever question is open.
  let transcript = caption;
  let displayText = caption;

  if (body.data.image) {
    const parsedImage = parseImageDataUrl(body.data.image.dataUrl);

    if (!parsedImage) {
      return NextResponse.json({ error: "Image is missing, unreadable, or too large (max 8 MB)." }, { status: 400 });
    }

    try {
      const converted = await convertVisualBytesToText({
        contentType: parsedImage.contentType,
        base64: parsedImage.base64,
        messageType: "image",
        caption,
      });
      transcript = `[System: User sent an image. Extracted content:]\n${converted}`;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      transcript = `[System: User sent an image. Conversion failed: ${reason}.]\n${caption ? `Caption: ${caption}\n` : ""}`;
    }
    displayText = caption ? `(sent an image) ${caption}` : "(sent an image)";
  }

  try {
    // Only the typed caption drives the flow; an image alone leaves the step
    // untouched and just re-states the current prompt.
    const { reply, form } = await runWebchatMenuTurn({ senderPhone: canonicalPhone, text: caption });

    const now = new Date().toISOString();
    await appendConversation(canonicalPhone, [
      { role: "user", text: transcript, time: now },
      { role: "assistant", text: reply, time: now },
    ]);

    await logWebchatExchange({
      canonicalPhone,
      inboundText: transcript,
      inboundMessageType: body.data.image ? "image" : "text",
      reply,
    });

    return NextResponse.json({ reply, displayText, form });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: `Unable to reach the referral assistant right now: ${message}` }, { status: 500 });
  }
}
