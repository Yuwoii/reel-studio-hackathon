// Spoken-number tokens (SRC1, W1 sources-first ruling 2026-11-03). One leaf module so the director's SRC1 gate
// (tools.ts unsourcedNumberGaps) and the data-pack numberSet (src/data/honeypotPack.ts) normalise numbers the SAME way.
// No imports on purpose: the host-side honeypot producer loads it without the director's dependency graph.

export const NUMBER_WORDS: Readonly<Record<string, string>> = { two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000", million: "1000000", billion: "1000000000" };
export const SPOKEN_NUMBER_RE = /\b\d[\d,.]*\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/gi;
/** "1,000" / "1000" / "thousand" → "1000" (digits only; a trailing "." is punctuation). */
export const normNumber = (t: string) => (NUMBER_WORDS[t.toLowerCase()] ?? t.replace(/[.,]+$/, "").replace(/,/g, ""));
export const numbersIn = (t: string) => [...String(t ?? "").matchAll(SPOKEN_NUMBER_RE)].map((m) => m[0]);
