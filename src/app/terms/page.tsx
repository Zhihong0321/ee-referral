import Link from "next/link";

import { COMPANY_LEGAL_NAME, REFERRAL_FEE_RATE, REFERRAL_TERMS } from "@/lib/terms";

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <section className="card-glow rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="pill inline-flex w-fit">Terms & Conditions</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Referral Program Terms</h1>
        <p className="mt-2 text-sm text-slate-600">
          Company: <span className="font-semibold text-slate-900">{COMPANY_LEGAL_NAME}</span>
        </p>
        <p className="text-sm text-slate-600">
          Standard referral fee: <span className="font-semibold text-slate-900">{REFERRAL_FEE_RATE}</span> per successful project total amount.
        </p>

        <div className="mt-6 space-y-6">
          {REFERRAL_TERMS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8">
          <Link href="/" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Back to landing page
          </Link>
        </div>
      </section>
    </main>
  );
}
