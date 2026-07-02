export type ParsedLeadCandidate = {
  leadName: string;
  leadMobileNumber: string;
  area: string;
  preferredAgentText: string;
  source: "structured_media" | "explicit_text";
  referrerPhone?: string;
};

const PHONE_PATTERN = /(?:\+?60|0)(?:[\s().-]*\d){7,11}/g;
const WRITE_INTENT_PATTERN =
  /\b(add|save|submit|refer|referral|new lead|call|contact|lead|customer|prospect|pass|assign|give)\b|新增|添加|推荐|介紹|介绍|tambah|simpan|rujuk/i;
const ASSIGNMENT_PATTERN =
  /\b(?:pass|assign|send|give)\s+(?:this\s+|the\s+)?(?:lead\s+)?to\s+(.+)|\b(?:let|ask)\s+(.+?)\s+(?:handle|follow\s*up)|\b(?:pic|preferred\s+agent|agent)\s*[:=-]?\s*(.+)/i;

function cleanValue(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s|:=-]+|[\s|]+$/g, "").trim();
}

function labeledValue(text: string, label: string) {
  const match = text.match(new RegExp(`${label}\\s*:\\s*([^|\\n]+)`, "i"));
  return cleanValue(match?.[1] || "");
}

function optionalLabeledValue(text: string, label: string) {
  const value = labeledValue(text, label);
  return /^(?:none|none visible|not visible|not provided|unknown|n\/a|null|-)?$/i.test(value) ? "" : value;
}

export function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Resolve a free-text name against the agent roster. Deliberately stricter
 * than plain substring matching: with ~150 agents, a 2-3 character fragment
 * silently "matching" some agent turned wrong-slot names into wrong writes.
 * Ranking (best wins; ties -> ambiguous):
 *   100 exact full name
 *    90 every query token is an exact token of the name ("zhi hong" -> GAN ZHI HONG)
 *    85 the full agent name appears inside a longer query text
 *    80 compact containment, but only for queries of 4+ characters ("zhihong")
 *    70 every query token (3+ chars) is a prefix of a name token ("ali" -> ALIA)
 *  else count of exact 3+ char token overlaps
 */
export function matchAgentName<T extends { name: string }>(rawText: string, agents: T[]) {
  const query = normalizeComparableText(rawText);
  if (!query) return { status: "missing" as const, matches: [] as T[] };
  const compactQuery = query.replace(/\s+/g, "");
  const queryTokens = query.split(" ").filter(Boolean);

  const scored = agents
    .map((agent) => {
      const name = normalizeComparableText(agent.name);
      const compactName = name.replace(/\s+/g, "");
      const nameTokens = name.split(" ").filter(Boolean);

      let score = 0;
      if (name === query || compactName === compactQuery) {
        score = 100;
      } else if (queryTokens.length > 0 && queryTokens.every((token) => nameTokens.includes(token))) {
        score = 90;
      } else if (compactName.length >= 4 && compactQuery.includes(compactName)) {
        score = 85;
      } else if (compactQuery.length >= 4 && compactName.includes(compactQuery)) {
        score = 80;
      } else if (
        queryTokens.length > 0 &&
        queryTokens.every((token) => token.length >= 3 && nameTokens.some((nameToken) => nameToken.startsWith(token)))
      ) {
        score = 70;
      } else {
        score = queryTokens.filter((token) => token.length >= 3 && nameTokens.includes(token)).length;
      }

      return { agent, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "none" as const, matches: [] as T[] };
  const best = scored.filter((item) => item.score === scored[0].score).map((item) => item.agent);
  return best.length === 1
    ? { status: "matched" as const, matches: best }
    : { status: "ambiguous" as const, matches: best };
}

export function extractPhoneText(value: string) {
  const matches = value.match(PHONE_PATTERN) || [];
  return cleanValue(matches[0] || "");
}

export function extractAssignmentText(value: string) {
  const match = value.match(ASSIGNMENT_PATTERN);
  return cleanValue(match?.[1] || match?.[2] || match?.[3] || "");
}

function inferNameFromText(text: string, phone: string) {
  const explicit = text.match(/\bname\s*(?:is|:|=)?\s*([^,|;\n]+)/i);
  if (explicit?.[1]) return cleanValue(explicit[1].replace(/\s+\b(?:from|in|area)\b.+$/i, ""));

  return cleanValue(
    text
      .replace(phone, " ")
      .replace(ASSIGNMENT_PATTERN, " ")
      .replace(/\b(add|save|submit|refer|referral|new|lead|call|contact|customer|prospect|his|her|number|phone|mobile|is|please|also|btw)\b/gi, " "),
  ).replace(/\s+\b(?:from|in|area)\b.+$/i, "");
}

export function parseLeadCandidate(text: string): ParsedLeadCandidate | null {
  if (/WhatsApp contact card(?:s)? received:/i.test(text)) {
    const contact = text.match(/^\s*\d+\.\s*(.+?)\s+[—-]\s+(.+?)\s*$/m);
    const phone = cleanValue(contact?.[2] || "");
    if (!phone) return null;
    return {
      leadName: cleanValue(contact?.[1] || ""),
      leadMobileNumber: phone,
      area: "",
      preferredAgentText: "",
      source: "structured_media",
    };
  }

  const structured =
    /\[System:\s*User sent an (?:image|video)\. Extracted content:\]/i.test(text) ||
    /\bLead phone\s*:/i.test(text);

  if (structured) {
    const phone = labeledValue(text, "Lead phone");
    if (!phone) return null;

    return {
      leadName: labeledValue(text, "Lead name"),
      leadMobileNumber: phone,
      area: labeledValue(text, "Area"),
      preferredAgentText: optionalLabeledValue(text, "Preferred agent"),
      source: "structured_media",
    };
  }

  const phone = extractPhoneText(text);
  if (!phone) return null;
  const remainder = cleanValue(text.replace(phone, " "));
  const looksLikeQuestion = /\?|(?:do|did|have|has|check|status|already|existing|find|search)\b/i.test(text);
  const isBareLead = !looksLikeQuestion && remainder.split(/\s+/).filter(Boolean).length <= 5;
  const isFollowUpNumber = /\b(?:his|her|their)\s+(?:number|phone|mobile)\b/i.test(text);
  if (!WRITE_INTENT_PATTERN.test(text) && !isBareLead && !isFollowUpNumber) return null;

  const areaMatch = text.match(/\b(?:from|area|in)\s+([^,|;\n]+(?:,\s*[^,|;\n]+)?)/i);
  return {
    leadName: inferNameFromText(text, phone),
    leadMobileNumber: phone,
    area: cleanValue(areaMatch?.[1] || ""),
    preferredAgentText: extractAssignmentText(text),
    source: "explicit_text",
  };
}

export function isSkipMessage(text: string) {
  return /^(?:no|nope|skip|none|n\/a|not now|later|tak|tiada|不用|跳过|跳過)\b/i.test(text.trim());
}

export function isCancelMessage(text: string) {
  return /\b(?:cancel|stop|abort|sent wrong|wrong one|ignore that|never mind|nevermind|batal|取消)\b/i.test(text);
}

export function parseExplicitLeadUpdate(text: string) {
  const assignment = text.match(/\bassign\s+(?:lead\s*)?(\d+)(?:'s)?(?:\s+agent)?\s+to\s+(.+)/i);
  if (assignment) {
    return {
      leadNumber: Number(assignment[1]),
      field: "agent" as const,
      value: cleanValue(assignment[2]),
    };
  }

  const numbered = text.match(
    /\b(?:change|update|edit|set)\s+(?:lead\s*)?(\d+)(?:'s)?\s+(name|phone|mobile|area|agent)\s+(?:to\s+)?(.+)/i,
  );
  if (!numbered) return null;

  return {
    leadNumber: Number(numbered[1]),
    field: numbered[2].toLowerCase() as "name" | "phone" | "mobile" | "area" | "agent",
    value: cleanValue(numbered[3]),
  };
}

export function isAdminModeTrigger(text: string) {
  return /^ee-admin$/i.test(text.trim());
}

export function isAdminModeExit(text: string) {
  return /^(?:exit|done|quit|leave)$/i.test(text.trim());
}
