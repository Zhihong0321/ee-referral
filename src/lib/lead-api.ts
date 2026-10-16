import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { toCanonicalMalaysiaPhone } from "./phone-normalization.ts";
import { normalizeAdSourceName, PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "./referral-options.ts";

const sourceNameSchema = z.string().trim().min(2).max(120).transform(normalizeAdSourceName);

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

export type ApiAgentOption = {
  id: string;
  name: string;
  bubbleId: string;
  numericId: number;
  accessLevels: string[];
};

export type ApiLeadSource = {
  id: string;
  name: string;
  type: "ads" | "other";
};

export const listLeadsQuerySchema = z.strictObject({
  referrer: sourceNameSchema.optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(500)).default(100),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2147483647)).default(0),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export type ListedApiLead = {
  referralId: number;
  leadCustomerId: string | null;
  leadName: string;
  leadMobileNumber: string | null;
  referrer: { customerId: string; name: string; type: "source" };
  assignedAgentId: string | null;
  status: string;
  leadState: string;
  leadCity: string;
  leadAddress: string;
  relationship: string;
  projectType: string;
  remark: string;
  createdAt: string | null;
};

export type ApiLeadList = {
  leads: ListedApiLead[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
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

export function authenticateLeadApiKey(request: Request, expectedKey: string | undefined): Response | null {
  const json = (body: unknown, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  if (!expectedKey) {
    return json({ error: "The lead API is not configured on this server.", code: "API_NOT_CONFIGURED" }, 503);
  }

  const authHeader = request.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerKey = match ? match[1].trim() : "";
  if (!bearerKey) {
    return json({ error: "Missing or invalid Authorization header. Send Bearer <LEADS_API_KEY>.", code: "UNAUTHORIZED" }, 401);
  }

  const expectedBuffer = createHash("sha256").update(expectedKey).digest();
  const actualBuffer = createHash("sha256").update(bearerKey).digest();
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return json({ error: "Invalid API key.", code: "UNAUTHORIZED" }, 401);
  }

  return null;
}

export function createListAgentsApiHandler(dependencies: {
  getApiKey: () => string | undefined;
  listAgents: () => Promise<ApiAgentOption[]>;
}) {
  const json = (body: unknown, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  return async function GET(request: Request) {
    const authError = authenticateLeadApiKey(request, dependencies.getApiKey());
    if (authError) return authError;

    try {
      const agents = await dependencies.listAgents();
      return json({ agents }, 200);
    } catch (error) {
      if (error instanceof LeadApiError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      console.error("[lead-api] Failed to list agents.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Unable to retrieve agents right now.", code: "INTERNAL_ERROR" }, 500);
    }
  };
}

export function createListSourcesApiHandler(dependencies: {
  getApiKey: () => string | undefined;
  listSources: () => Promise<ApiLeadSource[]>;
}) {
  const json = (body: unknown, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  return async function GET(request: Request) {
    const authError = authenticateLeadApiKey(request, dependencies.getApiKey());
    if (authError) return authError;

    try {
      const sources = await dependencies.listSources();
      return json({ sources, ads: sources.filter((s) => s.type === "ads") }, 200);
    } catch (error) {
      if (error instanceof LeadApiError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      console.error("[lead-api] Failed to list sources.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Unable to retrieve lead sources right now.", code: "INTERNAL_ERROR" }, 500);
    }
  };
}

export function createListLeadsApiHandler(dependencies: {
  getApiKey: () => string | undefined;
  listLeads: (query: ListLeadsQuery) => Promise<ApiLeadList>;
}) {
  const json = (body: unknown, status: number) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  return async function GET(request: Request) {
    const authError = authenticateLeadApiKey(request, dependencies.getApiKey());
    if (authError) return authError;

    const searchParams = new URL(request.url).searchParams;
    const parsed = listLeadsQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success || [...searchParams.keys()].some((key) => searchParams.getAll(key).length > 1)) {
      return json({ error: "Invalid lead query. Use referrer, limit (1-500), and offset (0-2147483647), once each.", code: "INVALID_INPUT" }, 400);
    }

    try {
      return json(await dependencies.listLeads(parsed.data), 200);
    } catch (error) {
      if (error instanceof LeadApiError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      console.error("[lead-api] Failed to list leads.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Unable to retrieve leads right now.", code: "INTERNAL_ERROR" }, 500);
    }
  };
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
    const authError = authenticateLeadApiKey(request, dependencies.getApiKey());
    if (authError) return authError;

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
        error: "Invalid lead payload.",
        code: "INVALID_INPUT",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, 400);
    }

    try {
      const created = await dependencies.createLead(parsed.data);
      return json({ lead: created }, 201);
    } catch (error) {
      if (error instanceof LeadApiError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      console.error("[lead-api] Lead creation failed.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Unable to create lead right now.", code: "INTERNAL_ERROR" }, 500);
    }
  };
}
