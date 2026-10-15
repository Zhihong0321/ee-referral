import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { toCanonicalMalaysiaPhone } from "./phone-normalization.ts";
import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "./referral-options.ts";

const sourceNameSchema = z.string().trim().min(2).max(120).transform((value) => {
  const name = value.replace(/\s+/g, " ");
  if (name.toLowerCase() === "google ads") return "Google Ads";
  if (name.toLowerCase() === "facebook ads") return "Facebook Ads";
  return name;
});

export const leadApiInputSchema = z.strictObject({
  leadName: z.string().trim().min(2).max(120),
  leadMobileNumber: z.string().trim().min(6).max(40)
    .regex(/^\+?[\d\s().-]+$/, "Enter a valid mobile number.")
    .transform(toCanonicalMalaysiaPhone)
    .refine((value) => /^60\d{9,11}$/.test(value), "Enter a valid Malaysian mobile number."),
  referrer: z.union([
    sourceNameSchema,
    z.strictObject({ customerId: z.string().trim().min(1).max(120) }),
  ]),
  assignedAgentId: z.union([z.string(), z.number().int().positive().safe()])
    .transform(String).pipe(z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/))
    .optional(),
  leadState: z.string().trim().max(120).default(""),
  leadCity: z.string().trim().max(120).default(""),
  leadAddress: z.string().trim().max(500).default(""),
  relationship: z.enum(RELATIONSHIP_OPTIONS).default("Other"),
  projectType: z.enum(PROJECT_TYPE_OPTIONS).default("OTHERS"),
  remark: z.string().trim().max(500).default(""),
});

export type LeadApiInput = z.infer<typeof leadApiInputSchema>;

export type CreatedApiLead = {
  referralId: number;
  leadCustomerId: string;
  leadName: string;
  leadMobileNumber: string;
  referrer: { customerId: string; name: string; type: "source" | "person" };
  assignedAgentId: string | null;
  status: "Pending" | "Assigned";
};

export class LeadApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LeadApiError";
    this.status = status;
    this.code = code;
  }
}

export function leadSourceCustomerId(name: string) {
  // Stable across case/spacing variants and concurrent requests, without a phone
  // or a referral/payout account for an advertising channel.
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  return `src_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function createLeadApiHandler(dependencies: {
  getApiKey: () => string | undefined;
  createLead: (input: LeadApiInput) => Promise<CreatedApiLead>;
}) {
  const json = (body: unknown, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  return async function POST(request: Request) {
    const expected = dependencies.getApiKey()?.trim();
    if (!expected) {
      return json({ error: "Lead API is not configured.", code: "API_NOT_CONFIGURED" }, 503);
    }

    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (!token || !timingSafeEqual(digest(token), digest(expected))) {
      return json({ error: "Invalid or missing API key.", code: "UNAUTHORIZED" }, 401);
    }

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return json({ error: "Send an application/json request body.", code: "INVALID_CONTENT_TYPE" }, 415);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, 400);
    }

    const parsed = leadApiInputSchema.safeParse(body);
    if (!parsed.success) {
      return json({
        error: "Invalid lead details.",
        code: "INVALID_INPUT",
        issues: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
      }, 400);
    }

    try {
      return json({ lead: await dependencies.createLead(parsed.data) }, 201);
    } catch (error) {
      if (error instanceof LeadApiError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      // Do not return database errors or log request bodies containing lead data.
      console.error("[lead-api] Lead creation failed.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Unable to create the lead right now.", code: "INTERNAL_ERROR" }, 500);
    }
  };
}
