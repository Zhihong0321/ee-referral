import Link from "next/link";

import { COMPANY_LEGAL_NAME, REFERRAL_FEE_RATE } from "@/lib/terms";

const STEPS = [
  {
    title: "1. Sign In With WhatsApp",
    description:
      "You log in once through Auth Hub at auth.atap.solar. Your secure auth cookie returns you to the referral dashboard.",
  },
  {
    title: "2. Submit A Lead",
    description:
      "Only four fields are needed: lead name, mobile number, living region, and your relationship with the lead.",
  },
  {
    title: "3. Track Lead Status",
    description:
      "You can monitor each referral from pending to won, and update lead details anytime from your dashboard.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <section className="hero-reveal card-glow relative overflow-hidden rounded-3xl border border-amber-200/70 bg-[linear-gradient(135deg,#fff7e8_0%,#ffffff_55%,#ecfffc_100%)] p-7 sm:p-10">
        <div className="absolute -top-20 right-[-40px] h-52 w-52 rounded-full bg-amber-300/30 blur-3xl" aria-hidden />
        <div className="absolute bottom-[-80px] left-[-60px] h-48 w-48 rounded-full bg-teal-300/30 blur-3xl" aria-hidden />

        <p className="pill inline-flex w-fit items-center gap-2">Eternalgy Referral Program</p>
        <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-bold sm:text-5xl">
          Convert Your Contacts Into Cash.
          <br />
          Earn <span className="text-amber-700">{REFERRAL_FEE_RATE} commission</span> for every successful project you
          refer.
        </h1>
        <p className="hero-reveal hero-delay mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
          Bring us qualified leads and we reward you with {REFERRAL_FEE_RATE} of each project total amount. Start by
          signing in with your WhatsApp account, then submit and manage referrals from one dashboard.
        </p>

        <div className="hero-reveal hero-delay-2 mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/auth/start?return_to=/dashboard"
            className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            Sign In With WhatsApp
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Open Dashboard
          </Link>
          <Link
            href="/terms"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Terms & Conditions
          </Link>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <article
            key={step.title}
            className="card-glow hero-reveal rounded-2xl border border-slate-200 bg-white p-5"
            style={{ animationDelay: `${0.1 + index * 0.08}s` }}
          >
            <h2 className="text-lg font-semibold text-slate-900">{step.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">{step.description}</p>
          </article>
        ))}
      </section>

      <section className="hero-reveal mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h3 className="text-2xl font-semibold text-slate-900">Program Notes</h3>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700 sm:text-base">
          <li>Company legal name: {COMPANY_LEGAL_NAME}.</li>
          <li>Commission rate: {REFERRAL_FEE_RATE} of each successful project total amount.</li>
          <li>WhatsApp sign-in is mandatory before creating a referral account.</li>
          <li>No full address is required for leads, only living region.</li>
          <li>The dashboard supports profile updates, adding and editing referrals.</li>
        </ul>
      </section>

      <section className="hero-reveal mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">Important Terms Notice</p>
        <p className="mt-1 leading-6">
          {COMPANY_LEGAL_NAME} reserves the right to revise, withhold, offset, or cancel referral fees in the event of
          dispute, cancellation, duplicate claim, or invalid referral information.
        </p>
      </section>
    </main>
  );
}
