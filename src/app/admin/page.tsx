import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { adminLoginAction, adminLogoutAction, adminUpdateReferralWorkflowAction } from "@/app/admin/actions";
import AgentSearchField from "@/components/agent-search-field";
import {
  REFERRAL_STATUSES,
  listAgentOptions,
  listManagerReferralLeads,
} from "@/lib/referrals";

type AdminPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    search?: string;
    assignment?: string;
    status?: string;
    preferredAgentId?: string;
    assignedAgentId?: string;
  }>;
};

type FlashMessagesProps = {
  success?: string;
  error?: string;
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

function getStatusOptions(status: string | null) {
  if (!status || REFERRAL_STATUSES.includes(status as (typeof REFERRAL_STATUSES)[number])) {
    return REFERRAL_STATUSES;
  }

  return [status, ...REFERRAL_STATUSES];
}

function formatLocation(state: string | null, city: string | null, address: string | null) {
  const parts = [state, city, address].map((value) => value?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "Location not provided";
}

function FlashMessages({ success, error }: FlashMessagesProps) {
  return (
    <>
      {success ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}
    </>
  );
}

function DashboardShell({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <header className="card-glow hero-reveal rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="pill inline-flex w-fit">{badge}</p>
            <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{subtitle}</p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Link href="/" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Return Home
            </Link>
            <form action={adminLogoutAction}>
              <button type="submit" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
                Admin Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </main>
  );
}

function LoginShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center px-5 py-8">
      <div className="card-glow hero-reveal w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900 text-center">Admin Access</h1>
        <p className="mt-2 text-sm text-slate-600 text-center mb-6">Enter password to continue</p>
        {children}
      </div>
    </main>
  );
}

async function renderAdminDashboard(params: Awaited<AdminPageProps["searchParams"]>) {
  const assignment =
    params.assignment === "assigned" || params.assignment === "unassigned" ? params.assignment : "";
  const filters = {
    search: params.search?.trim() || "",
    assignment,
    status: params.status?.trim() || "",
    preferredAgentId: params.preferredAgentId?.trim() || "",
    assignedAgentId: params.assignedAgentId?.trim() || "",
  } as const;
  
  const [agentOptions, referrals] = await Promise.all([listAgentOptions(), listManagerReferralLeads(filters)]);

  return (
    <DashboardShell
      badge="Admin Dashboard"
      title="Global Referrals Queue"
      subtitle="Complete view of all incoming referrals. You can search, filter, and assign/reassign to internal agents."
    >
      <FlashMessages success={params.success} error={params.error} />

      <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Filter Leads</h2>
            <p className="mt-1 text-sm text-slate-600">Search by lead name or mobile number and refine by assignment or agent.</p>
          </div>
          <Link href="/admin" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Reset filters
          </Link>
        </div>

        <form method="GET" action="/admin" className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            Search
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
              placeholder="Lead name or mobile number"
            />
          </label>

          <label className="text-sm text-slate-700">
            Assignment
            <select
              name="assignment"
              defaultValue={filters.assignment}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
            >
              <option value="">All leads</option>
              <option value="unassigned">Unassigned only</option>
              <option value="assigned">Assigned only</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Status
            <select
              name="status"
              defaultValue={filters.status}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
            >
              <option value="">All statuses</option>
              {REFERRAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <AgentSearchField
            agents={agentOptions}
            defaultAgentId={filters.preferredAgentId || null}
            label="Preferred agent filter"
            helperText="Leave blank to include every preferred agent."
          />

          <AgentSearchField
            agents={agentOptions}
            defaultAgentId={filters.assignedAgentId || null}
            inputName="assignedAgentId"
            label="Assigned agent filter"
            helperText="Leave blank to include every assigned agent."
          />

          <div className="md:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Apply Filters
            </button>
          </div>
        </form>
      </section>

      <section className="hero-reveal hero-delay-2 mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Lead Queue</h2>
          <span className="pill">Visible leads: {referrals.length}</span>
        </div>

        {referrals.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No leads matched the current filters.</p>
        ) : (
          <div className="mt-5 grid gap-4">
            {referrals.map((referral) => (
              <article key={referral.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{referral.leadName}</h3>
                    <p className="text-sm text-slate-600">
                      {referral.leadMobile || "-"} | {referral.relationship || "-"} | {referral.projectType || "Not set"}
                    </p>
                    <p className="text-sm text-slate-600">Referrer: {referral.referrerCustomerName || referral.referrerCustomerId}</p>
                    <p className="text-sm text-slate-600">
                      Location: {formatLocation(referral.leadState, referral.leadCity, referral.leadAddress)}
                    </p>
                    <p className="text-sm text-slate-600">
                      Preferred agent: {referral.preferredAgentName || "Not selected"}
                    </p>
                    <p className="text-sm text-slate-600">
                      Assigned agent: {referral.assignedAgentName || "Not assigned"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Submitted: {referral.createdAt || "Unknown"}</p>
                  </div>
                  <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                </div>

                <form action={adminUpdateReferralWorkflowAction} className="mt-4 grid gap-3 md:grid-cols-2">
                  <input type="hidden" name="referralId" value={referral.id} />
                  <AgentSearchField
                    agents={agentOptions}
                    defaultAgentId={referral.assignedAgentId}
                    inputName="assignedAgentId"
                    label="Admin assign to agent"
                    helperText="Leave blank to keep this lead unassigned."
                  />
                  <label className="text-sm text-slate-700">
                    Status
                    <select
                      name="status"
                      defaultValue={referral.status || "Pending"}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                    >
                      {getStatusOptions(referral.status).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
                    >
                      Save Assignment
                    </button>
                  </div>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const adminAccess = (await cookies()).get("admin_access")?.value;

  if (adminAccess === "true") {
    return renderAdminDashboard(params);
  }

  return (
    <LoginShell>
      <form action={adminLoginAction} className="flex flex-col gap-4">
        {params.error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {params.error}
          </p>
        )}
        <label className="text-sm font-semibold text-slate-700">
          Admin Password
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none ring-amber-500 focus:ring"
            placeholder="Enter the master password..."
          />
        </label>
        
        <button
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Secure Login
        </button>
        <Link 
          href="/" 
          className="text-center text-sm font-medium text-slate-500 hover:text-slate-700 mt-2"
        >
          Return to site
        </Link>
      </form>
    </LoginShell>
  );
}
