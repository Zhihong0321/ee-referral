import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addReferralAction,
  editReferralAction,
  updateProfileAction,
} from "@/app/dashboard/actions";
import { getCurrentAuthUser } from "@/lib/auth";
import {
  RELATIONSHIP_OPTIONS,
  REFERRAL_STATUSES,
  findOrCreateReferrerAccount,
  listReferralsByReferrer,
} from "@/lib/referrals";
import { COMPANY_LEGAL_NAME, REFERRAL_FEE_RATE } from "@/lib/terms";

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

function getRelationshipDefaultValue(relationship: string | null) {
  if (!relationship) {
    return "Other";
  }

  if (RELATIONSHIP_OPTIONS.includes(relationship as (typeof RELATIONSHIP_OPTIONS)[number])) {
    return relationship;
  }

  return "Other";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const authUser = await getCurrentAuthUser();

  if (!authUser) {
    redirect("/auth/start?return_to=/dashboard");
  }

  let referralId = "";
  let referralName = authUser.name?.trim() || authUser.phone;
  let profilePicture = "";
  let bankAccount = "";
  let bankerName = "";
  let referrals: Awaited<ReturnType<typeof listReferralsByReferrer>> = [];
  let loadError = "";

  try {
    const referralAccount = await findOrCreateReferrerAccount(authUser);
    referralId = referralAccount.customerId;
    referralName = referralAccount.name?.trim() || referralName;
    profilePicture = referralAccount.profilePicture || "";
    bankAccount = referralAccount.bankAccount || "";
    bankerName = referralAccount.bankerName || "";
    referrals = await listReferralsByReferrer(referralAccount.customerId);
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
            <span className="pill">Commission: {REFERRAL_FEE_RATE} per project total amount</span>
            <Link href="/terms" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View Terms & Conditions
            </Link>
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
                Profile picture URL
                <input
                  type="url"
                  name="profilePicture"
                  defaultValue={profilePicture}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
                  placeholder="https://example.com/photo.jpg"
                />
              </label>

              <label className="text-sm text-slate-700">
                Banking account
                <input
                  type="text"
                  name="bankAccount"
                  defaultValue={bankAccount}
                  required
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
                  required
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
          </section>

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
