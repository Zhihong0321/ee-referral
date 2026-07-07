"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "ee_webchat_phone";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_COMPOSER_HEIGHT = 200;

type ChatMessage = { role: "user" | "assistant"; text: string; time?: string | null; imageDataUrl?: string };

type Phase = "loading" | "login" | "chat";

type PendingImage = { dataUrl: string; name: string };

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden>
      <path
        d="M12 19V5M5 12l7-7 7 7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth={2} />
      <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth={2} />
      <path d="M21 15l-5-5-9 9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
}

export default function WebChat() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [phone, setPhone] = useState("");
  const [loginDraft, setLoginDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const loginInputRef = useRef<HTMLTextAreaElement | null>(null);

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
  }, [messages, phase, busy]);

  useEffect(() => {
    autoResize(composerRef.current);
  }, [draft]);

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
        await sendMessage({ text: "Hi", silent: true });
      }
    } catch {
      setError("Unable to log in right now.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(input: { text: string; image?: PendingImage; silent?: boolean }) {
    const { text, image, silent } = input;
    if (!phone && !silent) return;

    const activePhone = phone || (typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : "") || "";
    if (!activePhone) return;

    setBusy(true);
    setError("");

    if (!silent) {
      setMessages((prev) => [...prev, { role: "user", text, imageDataUrl: image?.dataUrl }]);
    }

    try {
      const response = await fetch("/api/web-chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activePhone,
          message: text,
          image: image ? { dataUrl: image.dataUrl } : undefined,
        }),
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
    if ((!value && !pendingImage) || busy) return;
    setDraft("");
    const image = pendingImage;
    setPendingImage(null);
    requestAnimationFrame(() => autoResize(composerRef.current));
    void sendMessage({ text: value, image: image || undefined });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");

    if (!file.type.startsWith("image/")) {
      setError("Please attach an image file.");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is too large (max 8 MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingImage({ dataUrl: reader.result, name: file.name });
      }
    };
    reader.onerror = () => setError("Unable to read that image.");
    reader.readAsDataURL(file);
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setPhone("");
    setMessages([]);
    setLoginDraft("");
    setPendingImage(null);
    setError("");
    setPhase("login");
  }

  if (phase === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#F9F8F6]">
        <TypingIndicator />
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-[#F9F8F6]">
        <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-black/5 hover:text-slate-800"
          >
            <BackIcon />
            Home
          </Link>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-24">
          <div className="w-full max-w-xl text-center">
            <h1 className="text-2xl font-semibold text-slate-800 sm:text-3xl">Referral Assistant</h1>
            <p className="mt-3 text-base leading-6 text-slate-500">
              What&apos;s your phone number? I&apos;ll use it to pull up your referral account.
            </p>
          </div>

          <form
            className="mt-6 w-full max-w-xl"
            onSubmit={(event) => {
              event.preventDefault();
              void submitLogin();
            }}
          >
            <div className="flex items-end gap-2 rounded-3xl border border-black/10 bg-white px-4 py-2.5 shadow-sm transition focus-within:border-black/25">
              <textarea
                ref={loginInputRef}
                value={loginDraft}
                onChange={(event) => setLoginDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitLogin();
                  }
                }}
                rows={1}
                inputMode="tel"
                autoFocus
                className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                placeholder="012-345 6789"
              />
              <button
                type="submit"
                disabled={busy || !loginDraft.trim()}
                className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                aria-label="Continue"
              >
                <SendIcon />
              </button>
            </div>
          </form>

          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F9F8F6]">
      <header className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-black/5 hover:text-slate-800"
            aria-label="Back to home"
          >
            <BackIcon />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">Referral Assistant</p>
            <p className="truncate font-mono text-xs text-slate-400">{phone}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-black/5 hover:text-slate-800"
        >
          Switch number
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-lg font-medium text-slate-600">Say hi to get started</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <div key={`user-${index}`} className="ml-auto max-w-[85%] sm:max-w-[75%]">
                    <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-[15px] leading-6 text-slate-900">
                      {message.imageDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={message.imageDataUrl}
                          alt="Attachment"
                          className={`max-h-56 rounded-lg object-contain ${message.text ? "mb-2" : ""}`}
                        />
                      ) : null}
                      {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
                    </div>
                  </div>
                ) : (
                  <div key={`assistant-${index}`} className="max-w-full">
                    <p className="text-[15px] leading-7 whitespace-pre-wrap text-slate-800">{message.text}</p>
                  </div>
                ),
              )}
              {busy ? <TypingIndicator /> : null}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-black/5 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

          {pendingImage ? (
            <div className="mb-2 flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage.dataUrl} alt="Selected attachment" className="h-12 w-12 rounded-lg object-cover" />
              <span className="flex-1 truncate text-sm text-slate-600">{pendingImage.name}</span>
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                Remove
              </button>
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitChatMessage();
            }}
          >
            <div className="flex items-end gap-2 rounded-3xl border border-black/10 bg-white px-3 py-2.5 shadow-sm transition focus-within:border-black/25">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Attach image"
              >
                <ImageIcon />
              </button>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitChatMessage();
                  }
                }}
                rows={1}
                className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                placeholder={pendingImage ? "Add a caption (optional)..." : "Message the referral assistant..."}
              />
              <button
                type="submit"
                disabled={busy || (!draft.trim() && !pendingImage)}
                className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
