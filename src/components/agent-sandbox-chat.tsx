"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  EMPTY_SANDBOX_AGENT_STATE,
  MAX_SANDBOX_ROUNDS,
  type SandboxAgentState,
  type SandboxConversationMessage,
  type SandboxTurn,
} from "@/lib/agent/sandbox-types";

type AgentSandboxChatProps = {
  phone: string;
};

type ApiSuccess = {
  turn: SandboxTurn;
  history: SandboxConversationMessage[];
  agentState: SandboxAgentState;
  maxRounds: number;
};

export default function AgentSandboxChat({ phone }: AgentSandboxChatProps) {
  const router = useRouter();
  const [history, setHistory] = useState<SandboxConversationMessage[]>([]);
  const [agentState, setAgentState] = useState<SandboxAgentState>(EMPTY_SANDBOX_AGENT_STATE);
  const [draft, setDraft] = useState("");
  const [lastTurn, setLastTurn] = useState<SandboxTurn | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const roundsUsed = useMemo(() => Math.floor(history.length / 2), [history.length]);

  function submitMessage() {
    const message = draft.trim();

    if (!message) {
      return;
    }

    startTransition(async () => {
      setError("");

      try {
        const response = await fetch("/api/agent-sandbox/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone,
            message,
            history,
            agentState,
          }),
        });

        const payload = (await response.json()) as ApiSuccess | { error?: string };

        if (!response.ok || !("turn" in payload)) {
          const message = "error" in payload ? payload.error : undefined;
          setError(message || "Unable to run the sandbox turn.");
          return;
        }

        setHistory(payload.history);
        setAgentState(payload.agentState);
        setLastTurn(payload.turn);
        setDraft("");
        if (payload.turn.intent === "create_lead_created") {
          router.refresh();
        }
      } catch {
        setError("Unable to run the sandbox turn.");
      }
    });
  }

  return (
    <section className="card-glow mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Sandbox Conversation</h2>
          <p className="mt-1 text-sm text-slate-600">
            MiniMax-backed chat loop with ephemeral browser memory only.
          </p>
        </div>
        <span className="pill">
          {roundsUsed}/{MAX_SANDBOX_ROUNDS} rounds
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        <label className="text-sm text-slate-700">
          User message
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
            placeholder='Try: "my leads", "show lead 1", or "help"'
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitMessage}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Running..." : "Run MiniMax Turn"}
          </button>
          <button
            type="button"
            onClick={() => {
              setHistory([]);
              setAgentState(EMPTY_SANDBOX_AGENT_STATE);
              setLastTurn(null);
              setDraft("");
              setError("");
            }}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Clear Local Memory
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-2xl border border-slate-200 bg-slate-50/40 p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Conversation Window</p>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No turns yet. Conversation memory lives only in this page state.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {history.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "border border-slate-200 bg-white text-slate-900"
                      : "border border-amber-200 bg-amber-50 text-slate-900"
                  }`}
                >
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{message.role}</p>
                  <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-slate-50/40 p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Last Turn Metadata</p>
          {lastTurn ? (
            <div className="mt-3 grid gap-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">Detected intent</p>
                <p className="mt-1 font-mono text-sm text-slate-900">{lastTurn.intent}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">Planned tools</p>
                {lastTurn.plannedTools.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-sm text-slate-900">
                    {lastTurn.plannedTools.map((tool) => (
                      <li key={tool}>{tool}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-600">No tool call required for this turn.</p>
                )}
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Memory is intentionally ephemeral and capped at 30 rounds. Business truth stays in Postgres.
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">Flow mode</p>
                <p className="mt-1 font-mono text-sm text-slate-900">{agentState.mode}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">No MiniMax turn has run yet.</p>
          )}
        </article>
      </div>
    </section>
  );
}
