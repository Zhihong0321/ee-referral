import { NextResponse } from "next/server";
import { z } from "zod";

import { getAgentSandboxSnapshot } from "@/lib/agent/sandbox";
import { buildOffTopicTurn, isOffTopicMessage, runLeadCollectionTurn, shouldStartLeadCollection } from "@/lib/agent/sandbox-flow";
import { MAX_SANDBOX_ROUNDS, type SandboxConversationMessage } from "@/lib/agent/sandbox-types";
import {
  runSandboxTurn,
  trimSandboxHistory,
} from "@/lib/agent/sandbox-chat";
import { EMPTY_SANDBOX_AGENT_STATE, type SandboxAgentState } from "@/lib/agent/sandbox-types";

export const runtime = "nodejs";

const requestSchema = z.object({
  phone: z.string().trim().min(1),
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(MAX_SANDBOX_ROUNDS * 2)
    .default([]),
  agentState: z
    .object({
      mode: z.enum(["idle", "collecting_lead", "confirming_lead"]),
      draft: z.record(z.string(), z.string()).default({}),
      nextField: z
        .enum(["leadName", "leadMobileNumber", "leadState", "leadCity", "leadAddress", "relationship", "projectType", "remark"])
        .nullable(),
    })
    .default(EMPTY_SANDBOX_AGENT_STATE),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const snapshot = await getAgentSandboxSnapshot(body.phone);
    const priorHistory: SandboxConversationMessage[] = trimSandboxHistory(body.history);
    const priorState = body.agentState as SandboxAgentState;
    const shouldHandleLeadFlow =
      priorState.mode !== "idle" ||
      shouldStartLeadCollection(body.message);

    const result = shouldHandleLeadFlow
      ? await runLeadCollectionTurn(snapshot, priorState, body.message)
      : {
          turn: isOffTopicMessage(body.message)
            ? buildOffTopicTurn(body.message)
            : await runSandboxTurn(snapshot, priorHistory, body.message),
          state: EMPTY_SANDBOX_AGENT_STATE,
        };

    const turn = result.turn;

    if (!turn) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const history = trimSandboxHistory([
      ...priorHistory,
      { role: "user", content: body.message },
      { role: "assistant", content: turn.reply },
    ]);

    return NextResponse.json({
      turn,
      history,
      agentState: result.state,
      maxRounds: MAX_SANDBOX_ROUNDS,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid request." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to run the sandbox turn right now." }, { status: 500 });
  }
}
