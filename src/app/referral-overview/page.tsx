import Link from "next/link";
import { listManagerReferralLeads } from "@/lib/referrals";

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

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return dateString;
  }
}

type StatCardProps = {
  label: string;
  value: number;
  color: "amber" | "slate" | "teal" | "emerald";
};

function StatCard({ label, value, color }: StatCardProps) {
  const colorClasses = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    teal: "border-teal-200 bg-teal-50 text-teal-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };

  return (
    <div className={`rounded-xl border ${colorClasses[color]} px-5 py-4`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

export default async function ReferralOverviewPage() {
  let referrals: Awaited<ReturnType<typeof listManagerReferralLeads>> = [];
  let loadError = "";

  try {
    referrals = await listManagerReferralLeads();
  } catch {
    loadError = "Unable to load referrals. Check database connection and environment variables.";
  }

  const total = referrals.length;
  const pending = referrals.filter(r => !r.status || r.status === "Pending").length;
  const assigned = referrals.filter(r => r.preferredAgentId && r.preferredAgentId.trim()).length;
  const successful = referrals.filter(r => r.status === "Successful").length;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <header className="card-glow hero-reveal rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="pill inline-flex w-fit">Referral Dashboard</p>
            <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Referral Overview</h1>
            <p className="mt-2 text-sm text-slate-600">
              Complete view of all referral submissions. Track incoming referrals, assignments, and status.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Link href="/" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Return Home
            </Link>
            <Link href="/dashboard" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
              Portal Dashboard
            </Link>
          </div>
        </div>
      </header>

      {loadError ? (
        <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          {loadError}
        </section>
      ) : (
        <>
          <section className="hero-reveal hero-delay mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Referrals" value={total} color="slate" />
            <StatCard label="Pending (In)" value={pending} color="amber" />
            <StatCard label="Assigned (Out)" value={assigned} color="teal" />
            <StatCard label="Successful" value={successful} color="emerald" />
          </section>

          <section className="hero-reveal hero-delay-2 mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold text-slate-900">All Referrals</h2>
              <span className="pill">Total: {referrals.length}</span>
            </div>

            {referrals.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No referrals found.</p>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="mt-5 hidden overflow-x-auto lg:block">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Lead
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Referral In
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Referral Out
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Linked Invoice
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrals.map((referral) => (
                        <tr key={referral.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-semibold text-slate-900">{referral.leadName}</p>
                              <p className="text-xs text-slate-600">{referral.leadMobile || "No phone"}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {referral.referrerCustomerName || "Unknown"}
                              </p>
                              <p className="text-xs font-mono text-slate-500">{referral.referrerCustomerId}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm text-slate-900">
                              {referral.preferredAgentName || <span className="text-slate-400">Not assigned</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs text-slate-700">
                              {referral.leadCustomerId || <span className="text-slate-400">N/A</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-slate-600">{formatDate(referral.createdAt)}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="mt-5 grid gap-4 lg:hidden">
                  {referrals.map((referral) => (
                    <article key={referral.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-slate-900">{referral.leadName}</h3>
                          <p className="text-sm text-slate-600">{referral.leadMobile || "No phone"}</p>
                        </div>
                        <span className={statusClassName(referral.status)}>{referral.status || "Pending"}</span>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm">
                        <div>
                          <span className="font-semibold text-slate-700">Referral In:</span>{" "}
                          <span className="text-slate-900">
                            {referral.referrerCustomerName || "Unknown"} 
                          </span>
                          <p className="text-xs font-mono text-slate-500">{referral.referrerCustomerId}</p>
                        </div>

                        <div>
                          <span className="font-semibold text-slate-700">Agent to Handle:</span>{" "}
                          <span className="text-slate-900">
                            {referral.preferredAgentName || <span className="text-slate-400">Not assigned</span>}
                          </span>
                        </div>

                        <div>
                          <span className="font-semibold text-slate-700">Linked Invoice:</span>{" "}
                          <span className="font-mono text-xs text-slate-700">
                            {referral.leadCustomerId || <span className="text-slate-400">N/A</span>}
                          </span>
                        </div>

                        <div>
                          <span className="font-semibold text-slate-700">Date:</span>{" "}
                          <span className="text-xs text-slate-600">{formatDate(referral.createdAt)}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
