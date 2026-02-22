import Link from "next/link";
import { redirect } from "next/navigation";

import { addReferralAction, editReferralAction } from "@/app/dashboard/actions";
import { getCurrentAuthUser } from "@/lib/auth";
import {
  REFERRAL_STATUSES,
  findOrCreateReferrerAccount,
  listReferralsByReferrer,
} from "@/lib/referrals";

type DashboardPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

function statusClassName(status: string | null) {
  const normalized = (status || "Pending").toLowerCase();

  if (normalized === "won") {
    return "status-badge status-won";
  }

  if (normalized === "lost") {
    return "status-badge status-lost";
  }

  if (normalized === "qualified" || normalized === "proposal") {
    return "status-badge status-qualified";
  }

  return "status-badge status-pending";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const authUser = await getCurrentAuthUser();

  if (!authUser) {
    redirect("/auth/start?return_to=/dashboard");
  }

  let referrerId = "";
  let referrerName = authUser.name?.trim() || authUser.phone;
  let referrals: Awaited<ReturnType<typeof listReferralsByReferrer>> = [];
  let loadError = "";

  try {
    const referrer = await findOrCreateReferrerAccount(authUser);
    referrerId = referrer.customerId;
    referrerName = referrer.name?.trim() || referrerName;
    referrals = await listReferralsByReferrer(referrer.customerId);
  } catch {
    loadError = "Unable to load your referral account. Check database write permissions and environment variables.";
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <header className="card-glow hero-reveal rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="pill inline-flex w-fit">Referral Dashboard</p>
            <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Welcome, {referrerName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              WhatsApp: <span className="font-semibold text-slate-900">{authUser.phone}</span>
            </p>
            <p className="text-sm text-slate-600">
              Referral Account ID: <span className="font-mono text-xs text-slate-800">{referrerId || "N/A"}</span>
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="pill">Commission: 2% per project total amount</span>
            <Link href="/auth/logout" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
              Logout
            </Link>
          </div>
        </div>
      </header>

      {params.success ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {params.success}
        </p>
      ) : null}

      {params.error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{params.error}</p>
      ) : null}

      {loadError ? (
        <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{loadError}</section>
      ) : (
        <>
          <section className="hero-reveal hero-delay mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-slate-900">Add Referral Lead</h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter lead name, mobile number, living region, and your relationship. No full address is required.
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
                Living region
                <input
                  type="text"
                  name="livingRegion"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. Shah Alam"
                />
              </label>

              <label className="text-sm text-slate-700">
                Relationship with lead
                <input
                  type="text"
                  name="relationship"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="e.g. Friend / Relative / Colleague"
                />
              </label>

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
                        <p className="text-sm text-slate-600">
                          {referral.leadMobile || "-"} | {referral.livingRegion || "-"} | {referral.relationship || "-"}
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
                          Living region
                          <input
                            type="text"
                            name="livingRegion"
                            defaultValue={referral.livingRegion || ""}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          Relationship
                          <input
                            type="text"
                            name="relationship"
                            defaultValue={referral.relationship || ""}
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          />
                        </label>

                        <label className="text-sm text-slate-700 md:col-span-2">
                          Lead status
                          <select
                            name="status"
                            defaultValue={referral.status || "Pending"}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                          >
                            {REFERRAL_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>

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
