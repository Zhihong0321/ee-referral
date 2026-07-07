import Link from "next/link";

import WebChat from "@/components/web-chat";
import { COMPANY_LEGAL_NAME } from "@/lib/terms";

export default function WebChatPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:px-8 sm:py-10">
      <section className="card-glow rounded-3xl border border-amber-200/70 bg-[linear-gradient(135deg,#fff7e8_0%,#ffffff_55%,#ecfffc_100%)] p-7 sm:p-10">
        <p className="pill inline-flex w-fit items-center gap-2">{COMPANY_LEGAL_NAME} Referral Assistant</p>
        <h1 className="mt-4 text-3xl leading-tight font-bold sm:text-4xl">Chat with the referral assistant</h1>
        <p className="mt-4 text-base leading-7 text-slate-700 sm:text-lg">
          Submit and manage your referral leads right here in the browser. Enter your phone number once to pull up
          your account, then chat the same way you would on WhatsApp.
        </p>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
          >
            Back to Home
          </Link>
        </div>
      </section>

      <div className="mt-8">
        <WebChat />
      </div>
    </main>
  );
}
