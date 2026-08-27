"use client";

import { useState } from "react";

import {
  validateAddLeadSubmission,
  validateProfileSubmission,
  type FieldErrors,
  type WebchatAddLeadForm,
  type WebchatForm,
  type WebchatProfileForm,
} from "@/lib/agent/webchat-forms";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

/**
 * The two webchat forms. Both submit in one shot: the browser validates with
 * the same pure functions the API route re-runs, so a rejected field reads the
 * same either way, and the route stays the authority.
 */

export type FormSubmitPayload = { kind: WebchatForm["kind"] } & Record<string, string>;

/** Resolves to field errors from the server, or null when the save succeeded. */
export type FormSubmitHandler = (payload: FormSubmitPayload) => Promise<FieldErrors | null>;

type FormCardProps = {
  busy: boolean;
  onCancel: () => void;
  onSubmit: FormSubmitHandler;
};

const LABEL_CLASS = "block text-xs font-semibold uppercase tracking-wide text-slate-500";
const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-800 outline-none transition focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-400";
const READONLY_CLASS = "mt-1.5 rounded-xl border border-dashed border-black/10 bg-slate-50 px-3 py-2.5";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-medium text-rose-600">{message}</p> : null;
}

function FormShell({
  title,
  subtitle,
  children,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm sm:p-5">
      <div className="border-b border-black/5 pb-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="mt-4 space-y-4">{children}</div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex flex-1 items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {busy ? "Saving..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-black/5 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddLeadFormCard({ form, busy, onCancel, onSubmit }: FormCardProps & { form: WebchatAddLeadForm }) {
  const [leadName, setLeadName] = useState("");
  const [leadMobileNumber, setLeadMobileNumber] = useState("");
  const [area, setArea] = useState("");
  const [preferredAgentId, setPreferredAgentId] = useState("");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const fields = { leadName, leadMobileNumber, area, preferredAgentId, remark };
    const validated = validateAddLeadSubmission(fields, {
      canonicalize: toCanonicalMalaysiaPhone,
      agentIds: form.agents.map((agent) => agent.id),
    });

    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }

    setErrors({});
    const serverErrors = await onSubmit({ kind: "add_lead", ...fields });
    if (serverErrors) setErrors(serverErrors);
  }

  return (
    <FormShell
      title="Add Lead"
      subtitle="添加目标客户"
      submitLabel="Submit lead"
      busy={busy}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor="lead-name">
          1. Lead · 目标客户
        </label>
        <input
          id="lead-name"
          value={leadName}
          onChange={(event) => setLeadName(event.target.value)}
          disabled={busy}
          className={INPUT_CLASS}
          placeholder="Lead's name"
          autoComplete="off"
        />
        <FieldError message={errors.leadName} />
        <input
          value={leadMobileNumber}
          onChange={(event) => setLeadMobileNumber(event.target.value)}
          disabled={busy}
          inputMode="tel"
          className={INPUT_CLASS}
          placeholder="Lead's phone number, e.g. 012-345 6789"
          autoComplete="off"
          aria-label="Lead's phone number"
        />
        <FieldError message={errors.leadMobileNumber} />
        <input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          disabled={busy}
          className={INPUT_CLASS}
          placeholder="Area or state (optional)"
          autoComplete="off"
          aria-label="Lead's area or state"
        />
      </div>

      <div>
        <span className={LABEL_CLASS}>2. From Referral · 介绍人</span>
        <div className={READONLY_CLASS}>
          <p className="text-[15px] leading-6 text-slate-700">{form.referrer.name}</p>
          <p className="font-mono text-xs text-slate-400">{form.referrer.phone}</p>
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor="lead-agent">
          3. Assigned to Agent
        </label>
        <select
          id="lead-agent"
          value={preferredAgentId}
          onChange={(event) => setPreferredAgentId(event.target.value)}
          disabled={busy || form.agents.length === 0}
          className={INPUT_CLASS}
        >
          <option value="">{form.agents.length === 0 ? "No agents available" : "No preference"}</option>
          {form.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <FieldError message={errors.preferredAgentId} />
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor="lead-remark">
          4. Remarks
        </label>
        <textarea
          id="lead-remark"
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          disabled={busy}
          rows={3}
          className={`${INPUT_CLASS} resize-none`}
          placeholder="Anything the agent should know (optional)"
        />
      </div>
    </FormShell>
  );
}

function ProfileFormCard({ form, busy, onCancel, onSubmit }: FormCardProps & { form: WebchatProfileForm }) {
  const [name, setName] = useState(form.values.name);
  const [bankAccount, setBankAccount] = useState(form.values.bankAccount);
  const [icNumber, setIcNumber] = useState(form.values.icNumber);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const fields = { name, bankAccount, icNumber };
    const validated = validateProfileSubmission(fields);

    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }

    setErrors({});
    const serverErrors = await onSubmit({ kind: "profile", ...fields });
    if (serverErrors) setErrors(serverErrors);
  }

  return (
    <FormShell
      title="My Details"
      subtitle="介绍人资料 · used for your referral payout"
      submitLabel="Save details"
      busy={busy}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor="profile-name">
          Referrer name · 介绍人姓名
        </label>
        <input
          id="profile-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          className={INPUT_CLASS}
          placeholder="Your full name as per IC"
          autoComplete="name"
        />
        <FieldError message={errors.name} />
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor="profile-bank">
          Bank account · 银行账号
        </label>
        <input
          id="profile-bank"
          value={bankAccount}
          onChange={(event) => setBankAccount(event.target.value)}
          disabled={busy}
          className={INPUT_CLASS}
          placeholder="Bank name and account number"
          autoComplete="off"
        />
        <FieldError message={errors.bankAccount} />
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor="profile-ic">
          IC number · 身份证号码
        </label>
        <input
          id="profile-ic"
          value={icNumber}
          onChange={(event) => setIcNumber(event.target.value)}
          disabled={busy}
          className={INPUT_CLASS}
          placeholder="e.g. 900101-14-5678"
          autoComplete="off"
        />
        <FieldError message={errors.icNumber} />
      </div>

      <div>
        <span className={LABEL_CLASS}>Phone · 电话</span>
        <div className={READONLY_CLASS}>
          <p className="font-mono text-[15px] leading-6 text-slate-500">{form.phone}</p>
        </div>
      </div>
    </FormShell>
  );
}

export function WebChatFormCard({ form, busy, onCancel, onSubmit }: FormCardProps & { form: WebchatForm }) {
  // Remounting on a new form clears whatever the previous one held.
  if (form.kind === "add_lead") {
    return <AddLeadFormCard key="add_lead" form={form} busy={busy} onCancel={onCancel} onSubmit={onSubmit} />;
  }

  return <ProfileFormCard key="profile" form={form} busy={busy} onCancel={onCancel} onSubmit={onSubmit} />;
}
