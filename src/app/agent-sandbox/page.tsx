import Link from "next/link";

import AgentSandboxChat from "@/components/agent-sandbox-chat";
import { DEFAULT_SANDBOX_PHONE, getAgentSandboxSnapshot } from "@/lib/agent/sandbox";
import { COMPANY_LEGAL_NAME } from "@/lib/terms";

type AgentSandboxPageProps = {
  searchParams: Promise<{
    phone?: string;
  }>;
};

function statusClassName(status: string | null) {
  const normalized = (status || "Pending").toLowerCase();

  if (normalized === "successful" || normalized === "won") {
    return "status-badge status-success";
  }

  if (normalized === "rejected" || normalized === "lost") {
    return "status-badge status-danger";
  }

  if (normalized === "qualified" || normalized === "contacted" || normalized === "assigned" || normalized === "proposal") {
    return "status-badge status-info";
  }

  return "status-badge status-pending";
}

function formatLocation(state: string | null, city: string | null, address: string | null) {
  const parts = [state, city, address].map((value) => value?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "Location not provided";
}

export default async function AgentSandboxPage({ searchParams }: AgentSandboxPageProps) {
  const params = await searchParams;
  const snapshot = await getAgentSandboxSnapshot(params.phone);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <section className="card-glow rounded-3xl border border-amber-200/70 bg-[linear-gradient(135deg,#fff7e8_0%,#ffffff_55%,#ecfffc_100%)] p-7 sm:p-10">
        <p className="pill inline-flex w-fit items-center gap-2">Phase 1 Agent Sandbox</p>
        <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-bold sm:text-5xl">Internal sandbox for the referral agent</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700 sm:text-lg">
          This milestone resolves an emulated sender phone against the current referral data model and now supports a
          confirmation-first add-lead flow before WhatsApp transport is enabled.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Back to Home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Existing Dashboard
          </Link>
        </div>
      </section>

      <section className="card-glow mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Sandbox Identity</h2>
            <p className="mt-1 text-sm text-slate-600">
              Use an emulated phone number to inspect the existing referral account and leads.
            </p>
          </div>
          <span className="pill">Phase 1 sandbox</span>
        </div>

        <form method="GET" className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="flex-1 text-sm text-slate-700">
            Emulated sender phone
            <input
              type="text"
              name="phone"
              defaultValue={snapshot.phone}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
              placeholder={DEFAULT_SANDBOX_PHONE}
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Load Sandbox
            </button>
          </div>
        </form>
      </section>

      <AgentSandboxChat key={snapshot.phone} phone={snapshot.phone} />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="card-glow rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Milestone</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Phase 1.4 uses MiniMax-backed chat, a confirmation-first add-lead flow, and ephemeral 30-round browser memory.
          </p>
        </article>
        <article className="card-glow rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Phone</h2>
          <p className="mt-2 font-mono text-sm leading-6 text-slate-700">{snapshot.phone}</p>
        </article>
        <article className="card-glow rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Current Leads</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">{snapshot.referrals.length} lead(s) found for the resolved referrer account.</p>
        </article>
      </section>

      <section className="card-glow mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">Referrer Account Snapshot</h2>

        {snapshot.referrer ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm text-slate-500">Customer ID</p>
              <p className="mt-1 font-mono text-sm text-slate-900">{snapshot.referrer.customerId}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm text-slate-500">Display Name</p>
              <p className="mt-1 text-sm text-slate-900">{snapshot.referrer.name}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm text-slate-500">Phone</p>
              <p className="mt-1 text-sm text-slate-900">{snapshot.referrer.phone}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm text-slate-500">Bank Account</p>
              <p className="mt-1 text-sm text-slate-900">{snapshot.referrer.bankAccount || "Not provided"}</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            No referral account was found for this phone. This milestone does not auto-create prod-backed referrer test
            accounts.
          </div>
        )}
      </section>

      <section className="card-glow mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Lead Snapshot</h2>
            <p className="mt-1 text-sm text-slate-600">
              Existing leads tied to the resolved sandbox referrer account inside {COMPANY_LEGAL_NAME}.
            </p>
          </div>
          <span className="pill">Live data</span>
        </div>

        {snapshot.referrals.length === 0 ? (
          <p className="mt-5 text-sm text-slate-600">No referral leads are currently linked to this sandbox identity.</p>
        ) : (
          <div className="mt-5 grid gap-4">
            {snapshot.referrals.map((referral) => (
              <article key={referral.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{referral.leadName}</h3>
                    <p className="text-sm text-slate-600">{referral.leadMobile || "-"}</p>
                    <p className="text-sm text-slate-600">
                      {formatLocation(referral.leadState, referral.leadCity, referral.leadAddress)}
                    </p>
                    <p className="text-sm text-slate-600">
                      Relationship: {referral.relationship || "-"} | Project type: {referral.projectType || "Not set"}
                    </p>
                    <p className="text-sm text-slate-600">
                      Preferred agent: {referral.preferredAgentName || "Not selected"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Lead record ID: {referral.id}</p>
                  </div>
                  <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
