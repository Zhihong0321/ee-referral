/**
 * Test endpoint for LLM-First Architecture (V2)
 *
 * Usage:
 * POST /api/whatsapp-agent/test-v2
 * {
 *   "phone": "60123456789",
 *   "message": "Hi, my name is Ahmad"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { runWhatsappAgentTurnV2 } from "@/lib/agent/whatsapp-flow-v2";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, message } = body;

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'phone' parameter" },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'message' parameter" },
        { status: 400 }
      );
    }

    const result = await runWhatsappAgentTurnV2({
      senderPhone: phone,
      text: message,
      dryRun: false,
    });

    return NextResponse.json({
      success: true,
      reply: result.reply,
      toolTrace: result.toolTrace,
      toolCount: result.toolTrace.length,
    });
  } catch (error) {
    console.error("Test V2 error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
