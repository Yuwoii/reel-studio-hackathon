// DataField family → preset mapping (R7 §3 + W3.1 P6). Pure, no imports: shared by the storyboard lint (L25) and,
// as an interface for the director prompt (src/director/v2/bible.ts FAMILIES), by whoever renders the preset table.
//
// `family` picks the default preset; a topic rule can override it when the topic's own texture fits better. W3 r2/r3
// shipped a TLS/PKI reel on family "network" → `nodes`, so an IP/ASN lattice sat behind a certificate-chain story;
// TLS / PKI / certificate topics now map to the `certs` preset (an openssl-verify-style chain log).

export const FIELD_PRESET_IDS = ["hex", "logs", "process", "nodes", "lattice", "matrix", "book", "certs"] as const;
export type FieldPresetId = (typeof FIELD_PRESET_IDS)[number];

export const FIELD_FAMILIES = ["security", "outage", "network", "systems", "science", "data"] as const;
export type FieldFamily = (typeof FIELD_FAMILIES)[number];

/** Default preset per family (R7 §3 F1–F6). */
export const FAMILY_PRESET: Readonly<Record<FieldFamily, FieldPresetId>> = {
  security: "hex",
  outage: "logs",
  network: "nodes",
  systems: "process",
  science: "lattice",
  data: "matrix",
};

export interface TopicPresetRule {
  id: string;
  preset: FieldPresetId;
  /** Families the rule applies to (a TLS outage reel is still a log tail). */
  families: readonly FieldFamily[];
  /** Tested against the reel's codename, header labels and spoken phrases. */
  match: RegExp;
  /** Minimum number of distinct matching terms (one stray "certificate" in a BGP reel is not a PKI topic). */
  minHits: number;
  why: string;
}

export const TOPIC_PRESET_RULES: readonly TopicPresetRule[] = [
  {
    id: "pki",
    preset: "certs",
    families: ["network", "security"],
    match: /\b(tls|ssl|https|x\.?509|pki|certificates?|certs?|cross-?signed|root ca|intermediate|chain of trust|trust (?:store|anchors?)|openssl|ocsp|crl|acme|notafter|notbefore|handshake|ca)\b/gi,
    minHits: 2,
    why: "TLS / PKI / certificate topics use the certs field (chain-verify rows), not the IP/ASN node lattice",
  },
];

/** Distinct lower-cased terms of `rule.match` found in `text`. */
export function topicHits(rule: TopicPresetRule, text: string): string[] {
  const hits = new Set<string>();
  for (const m of text.matchAll(new RegExp(rule.match.source, rule.match.flags.includes("g") ? rule.match.flags : `${rule.match.flags}g`))) hits.add(m[0].toLowerCase());
  return [...hits];
}

/** Preset the field should use for a family + topic text, with the rule that chose it (null = family default). */
export function presetForTopic(family: FieldFamily, text: string): { preset: FieldPresetId; rule: TopicPresetRule | null; hits: string[] } {
  for (const rule of TOPIC_PRESET_RULES) {
    if (!rule.families.includes(family)) continue;
    const hits = topicHits(rule, text);
    if (hits.length >= rule.minHits) return { preset: rule.preset, rule, hits };
  }
  return { preset: FAMILY_PRESET[family], rule: null, hits: [] };
}

/** Logs time hint carried on the storyboard (`datafield.seed` suffix "@HH:MM" or "@HH:MM:SS", e.g. "railway@07:35").
 *  Returns ms since midnight, or null. Pure; the DataField layer uses it for the log timestamps. */
export function fieldClockMs(hint: string | undefined | null): number | null {
  if (!hint) return null;
  const m = /(?:^|@)([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(hint.trim());
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3] ?? 0)) * 1000;
}
