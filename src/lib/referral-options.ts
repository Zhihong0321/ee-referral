export const RELATIONSHIP_OPTIONS = [
  "Family",
  "Friend",
  "Colleague",
  "Neighbor",
  "Business Partner",
  "Existing Customer",
  "Community Contact",
  "Other",
] as const;

export const PROJECT_TYPE_OPTIONS = ["RESIDENTIAL (2%)", "SHOP-LOT (2%)", "FACTORY (1%)", "OTHERS"] as const;

export const KNOWN_AD_SOURCES = [
  "Meta Ads Leon",
  "Google Ads Gan",
  "Facebook Ads",
  "Google Ads",
] as const;

export function normalizeAdSourceName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  for (const known of KNOWN_AD_SOURCES) {
    if (trimmed.toLowerCase() === known.toLowerCase()) {
      return known;
    }
  }
  return trimmed;
}

export function isDigitalAdSource(name: string): boolean {
  if (KNOWN_AD_SOURCES.some((s) => s.toLowerCase() === name.toLowerCase())) {
    return true;
  }
  return /ads|meta|google|facebook|tiktok|instagram/i.test(name);
}
