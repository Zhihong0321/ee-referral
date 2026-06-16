export type PhoneMatchCandidate = {
  value: string;
  rank: number;
  kind: "exact" | "canonical" | "local" | "plus" | "digits";
};

export function digitsOnly(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

export function toCanonicalMalaysiaPhone(value: string | null | undefined) {
  const digits = digitsOnly(value);

  if (!digits) {
    return "";
  }

  if (digits.startsWith("60")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `60${digits.slice(1)}`;
  }

  if (digits.startsWith("1")) {
    return `60${digits}`;
  }

  return digits;
}

export function toLocalMalaysiaPhone(value: string | null | undefined) {
  const canonical = toCanonicalMalaysiaPhone(value);

  if (canonical.startsWith("60")) {
    return `0${canonical.slice(2)}`;
  }

  return canonical;
}

export function buildPhoneMatchCandidates(value: string | null | undefined): PhoneMatchCandidate[] {
  const raw = (value || "").trim();
  const digits = digitsOnly(raw);
  const canonical = toCanonicalMalaysiaPhone(raw);
  const local = toLocalMalaysiaPhone(raw);
  const candidates: PhoneMatchCandidate[] = [];

  function add(candidate: PhoneMatchCandidate) {
    if (!candidate.value) {
      return;
    }

    if (candidates.some((existing) => existing.value === candidate.value)) {
      return;
    }

    candidates.push(candidate);
  }

  add({ value: raw, rank: 0, kind: "exact" });
  add({ value: digits, rank: raw === digits ? 0 : 4, kind: "digits" });
  add({ value: canonical, rank: raw === canonical || digits === canonical ? 1 : 2, kind: "canonical" });
  add({ value: local, rank: raw === local || digits === local ? 1 : 3, kind: "local" });
  add({ value: `+${canonical}`, rank: raw === `+${canonical}` ? 0 : 4, kind: "plus" });

  return candidates.sort((a, b) => a.rank - b.rank);
}
