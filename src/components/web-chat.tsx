"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ee_webchat_phone";

type ChatMessage = { role: "user" | "assistant"; text: string; time?: string | null };

type Phase = "loading" | "login" | "chat";

export default function WebChat() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [phone, setPhone] = useState("");
  const [loginDraft, setLoginDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedPhone = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;

    if (!savedPhone) {
      setPhase("login");
      return;
    }

    (async () => {
      try {
        const response = await fetch(`/api/web-chat/history?phone=${encodeURIComponent(savedPhone)}`);
        const payload = (await response.json()) as { messages?: ChatMessage[]; error?: string };

        if (!response.ok) {
          window.localStorage.removeItem(STORAGE_KEY);
          setPhase("login");
          return;
        }

        setPhone(savedPhone);
        setMessages(payload.messages || []);
        setPhase("chat");
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        setPhase("login");
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  async function submitLogin() {
    const value = loginDraft.trim();
    if (!value || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/web-chat/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: value }),
      });
      const payload = (await response.json()) as { phone?: string; isNew?: boolean; error?: string };

      if (!response.ok || !payload.phone) {
        setError(payload.error || "Unable to log in right now.");
        return;
      }

      window.localStorage.setItem(STORAGE_KEY, payload.phone);
      setPhone(payload.phone);
      setLoginDraft("");
      setMessages([]);
      setPhase("chat");

      if (payload.isNew) {
        await sendMessage("Hi", { silent: true });
      }
    } catch {
      setError("Unable to log in right now.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(text: string, opts: { silent?: boolean } = {}) {
    if (!phone && !opts.silent) return;

    const activePhone = phone || (typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : "") || "";
    if (!activePhone) return;

    setBusy(true);
    setError("");

    if (!opts.silent) {
      setMessages((prev) => [...prev, { role: "user", text }]);
    }

    try {
      const response = await fetch("/api/web-chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: activePhone, message: text }),
      });
      const payload = (await response.json()) as { reply?: string; error?: string };

      if (!response.ok || typeof payload.reply !== "string") {
        setError(payload.error || "Unable to reach the referral assistant right now.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", text: payload.reply as string }]);
    } catch {
      setError("Unable to reach the referral assistant right now.");
    } finally {
      setBusy(false);
    }
  }

  function submitChatMessage() {
    const value = draft.trim();
    if (!value || busy) return;
    setDraft("");
    void sendMessage(value);
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setPhone("");
    setMessages([]);
    setLoginDraft("");
    setError("");
    setPhase("login");
  }

  if (phase === "loading") {
    return (
      <section className="card-glow rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-sm text-slate-600">Loading...</p>
      </section>
    );
  }

  if (phase === "login") {
    return (
      <section className="card-glow rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          Hi! I&apos;m the referral assistant. What&apos;s your phone number? I&apos;ll use it to pull up your referral
          account.
        </div>

        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLogin();
          }}
        >
          <label className="flex-1 text-sm text-slate-700">
            Your phone number
            <input
              type="tel"
              value={loginDraft}
              onChange={(event) => setLoginDraft(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
              placeholder="012-345 6789"
              autoFocus
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? "Logging in..." : "Continue"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card-glow rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Referral Assistant</h2>
          <p className="mt-1 font-mono text-sm text-slate-600">{phone}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
        >
          Not you? Switch number
        </button>
      </div>

      <div className="mt-5 max-h-[28rem] min-h-[16rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-600">Say hi to get started.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto max-w-[85%] border border-teal-200 bg-teal-50 text-slate-900"
                    : "mr-auto max-w-[85%] border border-slate-200 bg-white text-slate-900"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.text}</p>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          submitChatMessage();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitChatMessage();
            }
          }}
          rows={2}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
          placeholder="Type your message..."
        />
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Sending..." : "Send"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}
    </section>
  );
}
