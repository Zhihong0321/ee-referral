import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  addReferralAction,
  editReferralAction,
  updateProfileAction,
  updateReferralWorkflowAction,
} from "@/app/dashboard/actions";
import AgentSearchField from "@/components/agent-search-field";
import { getCurrentAuthUser } from "@/lib/auth";
import { findInternalAppUser, hasAnyAccessLevel } from "@/lib/internal-users";
import {
  PROJECT_TYPE_OPTIONS,
  REFERRAL_STATUSES,
  RELATIONSHIP_OPTIONS,
  findOrCreateReferrerAccount,
  listAgentOptions,
  listAssignedReferrals,
  listManagerReferralLeads,
  listReferralsByReferrer,
} from "@/lib/referrals";
import { COMPANY_LEGAL_NAME, REFERRAL_FEE_RULE_SUMMARY, REFERRAL_PAYOUT_RULE } from "@/lib/terms";

type DashboardPageProps = {
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

function getRelationshipDefaultValue(relationship: string | null) {
  if (!relationship) {
    return "Other";
  }

  if (RELATIONSHIP_OPTIONS.includes(relationship as (typeof RELATIONSHIP_OPTIONS)[number])) {
    return relationship;
  }

  return "Other";
}

function getProjectTypeDefaultValue(projectType: string | null) {
  if (!projectType) {
    return "RESIDENTIAL (2%)";
  }

  if (PROJECT_TYPE_OPTIONS.includes(projectType as (typeof PROJECT_TYPE_OPTIONS)[number])) {
    return projectType;
  }

  return "OTHERS";
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
            <span className="pill">Commission: {REFERRAL_FEE_RULE_SUMMARY}</span>
            <Link href="/terms" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View Terms & Conditions
            </Link>
            <a href="/auth/logout" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
              Logout
            </a>
          </div>
        </div>
      </header>

      {children}
    </main>
  );
}

async function renderManagerDashboard(params: Awaited<DashboardPageProps["searchParams"]>, managerName: string) {
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
      badge="Manager Queue"
      title={`Referral Leads, ${managerName}`}
      subtitle="Review all incoming referrals, filter the queue, and assign or reassign leads to internal agents."
    >
      <FlashMessages success={params.success} error={params.error} />

      <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Filter Leads</h2>
            <p className="mt-1 text-sm text-slate-600">Search by lead name or mobile number and refine by assignment or agent.</p>
          </div>
          <Link href="/dashboard" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Reset filters
          </Link>
        </div>

        <form method="GET" className="mt-5 grid gap-4 md:grid-cols-2">
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

                <form action={updateReferralWorkflowAction} className="mt-4 grid gap-3 md:grid-cols-2">
                  <input type="hidden" name="referralId" value={referral.id} />
                  <AgentSearchField
                    agents={agentOptions}
                    defaultAgentId={referral.assignedAgentId}
                    inputName="assignedAgentId"
                    label="Assign agent"
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

async function renderAgentDashboard(
  params: Awaited<DashboardPageProps["searchParams"]>,
  agentName: string,
  agentId: string,
) {
  const referrals = await listAssignedReferrals(agentId);

  return (
    <DashboardShell
      badge="Assigned Leads"
      title={`Your Referral Leads, ${agentName}`}
      subtitle="This view only shows referral leads assigned to you by management."
    >
      <FlashMessages success={params.success} error={params.error} />

      <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Assigned Queue</h2>
          <span className="pill">Your leads: {referrals.length}</span>
        </div>

        {referrals.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No referral leads are assigned to you yet.</p>
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
                    <p className="mt-1 text-xs text-slate-500">Submitted: {referral.createdAt || "Unknown"}</p>
                  </div>
                  <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

async function renderReferrerDashboard(
  params: Awaited<DashboardPageProps["searchParams"]>,
  authUser: NonNullable<Awaited<ReturnType<typeof getCurrentAuthUser>>>,
) {
  let referralId = "";
  let referralName = authUser.name?.trim() || authUser.phone;
  let profilePicture = "";
  let bankAccount = "";
  let bankerName = "";
  let referrals: Awaited<ReturnType<typeof listReferralsByReferrer>> = [];
  let agents: Awaited<ReturnType<typeof listAgentOptions>> = [];
  let loadError = "";

  try {
    const referralAccount = await findOrCreateReferrerAccount(authUser);
    referralId = referralAccount.customerId;
    referralName = referralAccount.name?.trim() || referralName;
    profilePicture = referralAccount.profilePicture || "";
    bankAccount = referralAccount.bankAccount || "";
    bankerName = referralAccount.bankerName || "";
    [referrals, agents] = await Promise.all([
      listReferralsByReferrer(referralAccount.customerId),
      listAgentOptions(),
    ]);
  } catch {
    loadError = "Unable to load your referral account. Check database write permissions and environment variables.";
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <header className="card-glow hero-reveal rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-lg font-bold text-slate-700"
              style={
                profilePicture
                  ? {
                      backgroundImage: `url(${profilePicture})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
              aria-label="Referral profile picture"
            >
              {!profilePicture ? referralName.slice(0, 1).toUpperCase() : ""}
            </div>

            <div>
              <p className="pill inline-flex w-fit">Referral Dashboard</p>
              <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Welcome, {referralName}</h1>
              <p className="mt-2 text-sm text-slate-600">
                WhatsApp: <span className="font-semibold text-slate-900">{authUser.phone}</span>
              </p>
              <p className="text-sm text-slate-600">
                Referral Account ID: <span className="font-mono text-xs text-slate-800">{referralId || "N/A"}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="pill">Commission: {REFERRAL_FEE_RULE_SUMMARY}</span>
            <Link href="/terms" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View Terms & Conditions
            </Link>
            <a href="/auth/logout" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
              Logout
            </a>
          </div>
        </div>
      </header>

      <FlashMessages success={params.success} error={params.error} />

      {loadError ? (
        <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{loadError}</section>
      ) : (
        <>
          <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-slate-900">Referral Profile</h2>
            <p className="mt-2 text-sm text-slate-600">
              Update your payout profile details. These fields are required for referral fee processing.
            </p>

            <form action={updateProfileAction} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Name
                <input
                  type="text"
                  name="displayName"
                  defaultValue={referralName}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="Your full name"
                />
              </label>

              <label className="text-sm text-slate-700">
                Banking account
                <input
                  type="text"
                  name="bankAccount"
                  defaultValue={bankAccount}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="Bank account number"
                />
              </label>

              <label className="text-sm text-slate-700">
                Banker name
                <input
                  type="text"
                  name="bankerName"
                  defaultValue={bankerName}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="Bank name"
                />
              </label>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Update Profile
                </button>
              </div>
            </form>
          </section>

          <section className="hero-reveal mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Terms Notice</p>
            <p className="mt-1 leading-6">
              {COMPANY_LEGAL_NAME} reserves the right to revise, withhold, offset, or cancel referral fee in case of
              dispute, project cancellation, duplicate claim, or invalid submission.
            </p>
            <p className="mt-1 leading-6">{REFERRAL_PAYOUT_RULE}</p>
          </section>

          <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-slate-900">Add Referral Lead</h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter the lead details, location, relationship, project type, and your preferred handling agent.
            </p>

            <form action={addReferralAction} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Lead name
                <input
                  type="text"
                  name="leadName"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. Mr Lee"
                />
              </label>

              <label className="text-sm text-slate-700">
                Lead mobile number
                <input
                  type="text"
                  name="leadMobileNumber"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. 0123456789"
                />
              </label>

              <label className="text-sm text-slate-700">
                State
                <input
                  type="text"
                  name="leadState"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. Selangor"
                />
              </label>

              <label className="text-sm text-slate-700">
                City
                <input
                  type="text"
                  name="leadCity"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. Shah Alam"
                />
              </label>

              <label className="text-sm text-slate-700 md:col-span-2">
                Address
                <input
                  type="text"
                  name="leadAddress"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="Optional full address"
                />
              </label>

              <label className="text-sm text-slate-700">
                Relationship with lead
                <select
                  name="relationship"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  defaultValue="Friend"
                >
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-700">
                Project type
                <select
                  name="projectType"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  defaultValue="RESIDENTIAL (2%)"
                >
                  {PROJECT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <AgentSearchField agents={agents} />

              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
                >
                  Save Referral
                </button>
              </div>
            </form>
          </section>

          <section className="hero-reveal hero-delay-2 mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Your Referrals</h2>
              <span className="pill">Total referrals: {referrals.length}</span>
            </div>

            {referrals.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No referrals submitted yet.</p>
            ) : (
              <div className="mt-5 grid gap-4">
                {referrals.map((referral) => (
                  <article key={referral.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                        <p className="text-sm text-slate-600">
                          Assigned agent: {referral.assignedAgentName || "Not assigned yet"}
                        </p>
                      </div>
                      <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                    </div>

                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-teal-700">Edit referral</summary>
                      <form action={editReferralAction} className="mt-3 grid gap-3 md:grid-cols-2">
                        <input type="hidden" name="referralId" value={referral.id} />

                        <label className="text-sm text-slate-700">
                          Lead name
                          <input
                            type="text"
                            name="leadName"
                            defaultValue={referral.leadName}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          Lead mobile number
                          <input
                            type="text"
                            name="leadMobileNumber"
                            defaultValue={referral.leadMobile || ""}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          State
                          <input
                            type="text"
                            name="leadState"
                            defaultValue={referral.leadState || ""}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          City
                          <input
                            type="text"
                            name="leadCity"
                            defaultValue={referral.leadCity || ""}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700 md:col-span-2">
                          Address
                          <input
                            type="text"
                            name="leadAddress"
                            defaultValue={referral.leadAddress || ""}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          Relationship
                          <select
                            name="relationship"
                            defaultValue={getRelationshipDefaultValue(referral.relationship)}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          >
                            {RELATIONSHIP_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-sm text-slate-700">
                          Project type
                          <select
                            name="projectType"
                            defaultValue={getProjectTypeDefaultValue(referral.projectType)}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          >
                            {PROJECT_TYPE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <AgentSearchField
                          agents={agents}
                          defaultAgentId={referral.preferredAgentId}
                          label="Preferred Agent to Handle LEAD"
                        />

                        <div className="md:col-span-2">
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                          >
                            Update Referral
                          </button>
                        </div>
                      </form>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const authUser = await getCurrentAuthUser();

  if (!authUser) {
    redirect("/auth/start?return_to=/dashboard");
  }

  const internalUser = await findInternalAppUser(authUser);

  if (internalUser && hasAnyAccessLevel(internalUser.accessLevels, ["HR", "KC"])) {
    return renderManagerDashboard(params, internalUser.name);
  }

  if (internalUser?.agentId) {
    return renderAgentDashboard(params, internalUser.agentName || internalUser.name, internalUser.agentId);
  }

  return renderReferrerDashboard(params, authUser);
}
