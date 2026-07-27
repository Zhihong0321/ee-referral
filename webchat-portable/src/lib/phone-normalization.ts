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

/**
 * Canonical MATCH KEY for comparing two phone numbers regardless of country
 * code presence, leading zero, or formatting noise (spaces/dashes/parens).
 * Two numbers are "the same phone" iff this key is equal AND non-empty.
 * NOT for display or storage — comparison only.
 */
export function toPhoneMatchKey(value: string | null | undefined) {
  const digits = digitsOnly(value);
  if (digits.startsWith("60")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function toLocalMalaysiaPhone(value: string | null | undefined) {
  const canonical = toCanonicalMalaysiaPhone(value);

  if (canonical.startsWith("60")) {
    return `0${canonical.slice(2)}`;
  }

  return canonical;
}
