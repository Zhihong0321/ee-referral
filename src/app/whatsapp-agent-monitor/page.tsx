"use client";

import { useEffect, useState } from "react";

type DiagnosticPayload = {
  ok: boolean;
  checkedAt: string;
  checks: Record<string, { ok: boolean; data?: unknown; error?: string }>;
};

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`rounded px-2 py-1 text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
      {ok ? "WORKING" : "NOT WORKING"}
    </span>
  );
}

export default function WhatsappAgentMonitorPage() {
  const [payload, setPayload] = useState<DiagnosticPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/whatsapp-agent/diagnostics", { cache: "no-store" });
      const text = await response.text();
      const json = JSON.parse(text) as DiagnosticPayload;
      setPayload(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 font-mono text-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">WhatsApp Agent Monitor</h1>
          <p className="text-slate-600">Refreshes every 10 seconds.</p>
        </div>
        <button onClick={() => void load()} className="rounded bg-slate-950 px-4 py-2 font-bold text-white">
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {error ? <pre className="mb-4 whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</pre> : null}

      {payload ? (
        <>
          <section className="mb-4 rounded border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">Overall</p>
                <p className="text-slate-600">{payload.checkedAt}</p>
              </div>
              <StatusBadge ok={payload.ok} />
            </div>
          </section>

          <div className="grid gap-4">
            {Object.entries(payload.checks).map(([name, result]) => (
              <section key={name} className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">{name}</h2>
                  <StatusBadge ok={result.ok} />
                </div>
                {result.error ? (
                  <pre className="whitespace-pre-wrap rounded bg-rose-50 p-3 text-rose-800">{result.error}</pre>
                ) : (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-slate-50">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                )}
              </section>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
