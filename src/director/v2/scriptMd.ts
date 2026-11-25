// script.md for a saved v2 job (the owner-facing script sheet, and the IG drop's companion): the phrases with their
// part tags and keywords, Sources, a Fact check table (claim → verbatim source quote → url), the phrase → fact map
// with the fact-check verdicts, the rubric table and a lint summary.
// Pure: builds a string; save_job writes it into the job dir.

import { phraseBeatId, type ScriptV2 } from "../../schema/script.v2.js";
import { seriesOf } from "./topics.js";
import type { LintReport } from "../../v2/lints.js";
import type { FactVerdict, GroundingT, ResearchLedgerV2 } from "./research.js";
import { normUrl } from "./research.js";
import type { RubricResult } from "./rubric.js";
import type { AutoFixDecision, AutoFixRec, ReviewAck } from "./state.js";

/** Markdown table cell: no pipes or newlines. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

export interface ScriptMdInput {
  script: ScriptV2;
  rubric: RubricResult;
  lint: Pick<LintReport, "ok" | "blocked" | "counts" | "stats" | "results">;
  research?: ResearchLedgerV2;
  badges?: readonly string[];
  grounding?: GroundingT;
  verdicts?: readonly FactVerdict[];
  /** The director's stills-review acknowledgement (save_job `review`). */
  review?: ReviewAck;
  /** W3.1 r1: fact-check rewrites applied automatically (the director's refusals had run out). */
  autoFixes?: readonly AutoFixRec[];
  /** W3.2: every auto-fix decision (shortened / not applied, with why). */
  autoFixDecisions?: readonly AutoFixDecision[];
}

export function buildScriptMdV2({ script, rubric, lint, research, badges = [], grounding, verdicts, review, autoFixes = [], autoFixDecisions = [] }: ScriptMdInput): string {
  const src = new Map(script.sources.map((s) => [s.id, s]));
  const read = new Set((research?.fetched ?? []).map((u) => u));
  const out: string[] = [];
  out.push(`# ${seriesOf(script)} · ${script.codename} — ${script.title}`, "");
  if (script.story) {
    out.push(`**Question:** ${cell(script.story.question)}  `, `**Answer:** ${cell(script.story.answer)} _(source fact ${script.story.answerFact})_`, "");
    out.push("| Outline | Point |", "|---|---|", ...script.story.outline.map((o) => `| ${o.beats.join(", ")} | ${cell(o.point)} |`), "");
    if (script.story.terms.length) out.push(`**Terms:** ${script.story.terms.map((t) => `${cell(t.term)} (${t.beat}): ${cell(t.definition)}`).join(" · ")}`, "");
  }
  out.push(`- slug: \`${script.slug}\` · mode ${script.mode} · family ${script.family} · header ${script.headerMode}`);
  // W3.2: ONE word count (the rubric's narration tokenizer, as on the card and in the rubric) — script.md used the
  // lint's TTS-token count (event-recent r2: 192 words here vs 195 on the card).
  const st = rubric.stats;
  if (st) out.push(`- ${st.durationSec} s · ${st.words} words · ${st.wps ?? "?"} w/s${st.estimated ? " (estimate)" : ""} · ${script.phrases.length} phrases`);
  else if (lint.stats) out.push(`- ${lint.stats.durationSec} s · ${lint.stats.words} words · ${lint.stats.wordsPerSec} w/s · ${script.phrases.length} phrases`);
  out.push(`- rubric ${rubric.total}/${rubric.max} (need ${rubric.need}) **${rubric.pass ? "PASS" : "FAIL"}** · lints ${lint.counts.block} block / ${lint.counts.error} error / ${lint.counts.warn} warn`);
  for (const b of badges) out.push(`- ⚠️ ${b.replace(/^\w+:/, "")}`);
  out.push("", "## Narration", "");
  script.phrases.forEach((p, i) => out.push(`${i + 1}. \`${phraseBeatId(i)}\` [${p.part}] ${p.text}  — *${p.keyword}*`));

  out.push("", "## Sources", "");
  for (const s of script.sources) {
    const date = (s as { published?: string }).published ?? research?.pageDates?.[normUrl(s.url)];
    out.push(`- \`${s.id}\` ${s.title} — ${s.url}${date ? ` · ${date}` : ""}${research ? (read.has(normUrl(s.url)) ? "" : " *(not read with web_fetch)*") : ""}`);
  }

  out.push("", "## Fact check", "", "| Fact | Claim | Source quote | Source |", "|---|---|---|---|");
  for (const f of script.facts) {
    const s = src.get(f.sourceId);
    const q = (grounding?.quotes ?? []).filter((x) => x.fact === f.id).map((x) => `“${x.quote}”`).join(" ");
    out.push(`| \`${f.id}\` | ${cell(f.claim)}${f.illustrative ? " *(illustrative)*" : ""} | ${q ? cell(q).slice(0, 400) : "–"} | ${s ? cell(s.url) : cell(f.sourceId)} |`);
  }
  if (grounding) {
    const byBeat = new Map(grounding.beats.map((b) => [b.beat, b.facts]));
    const v = new Map((verdicts ?? []).map((x) => [x.beat, x]));
    out.push("", "## Claims → facts", "", "| Beat | Line | Facts | Fact check |", "|---|---|---|---|");
    script.phrases.forEach((p, i) => {
      const id = phraseBeatId(i);
      if (p.part === "cta") return;
      const fv = v.get(id);
      out.push(`| \`${id}\` | ${cell(p.text)} | ${(byBeat.get(id) ?? []).join(", ") || "–"} | ${fv ? `${fv.verdict}${fv.verdict === "supported" ? "" : `: ${cell(fv.why).slice(0, 160)}`}` : "–"} |`);
    });
  }

  if (autoFixes.length) {
    out.push("", "## Automatic fact-check rewrites", "", "The director ran out of rewrites; the fact checker's own suggestions were applied and re-checked:", "");
    for (const f of autoFixes) {
      const shortened = autoFixDecisions.some((d) => d.status === "shortened" && d.kind === f.kind && d.id === f.id && d.to === f.to);
      out.push(`- ${f.kind === "phrase" ? `\`${f.id}\` line` : `fact \`${f.id}\` claim`}: ${cell(f.from)} → **${cell(f.to)}**${shortened ? " *(the checker's rewrite, shortened)*" : ""}`);
    }
  }
  // W3.2 r2: page excerpts the checker said state a line, added to the fact's quotes (code-verified on the page).
  const quotes = autoFixDecisions.filter((d) => d.kind === "quote" && d.status === "applied");
  if (quotes.length) {
    out.push("", "## Quotes added by the fact check", "", "The checker found these lines stated on their page; the verbatim excerpt (found on the stored page by code) was added as a quote, the line kept and re-checked:", "");
    for (const d of quotes) out.push(`- ${d.beat ? `\`${d.beat}\` → ` : ""}fact \`${d.id}\`: “${cell(d.proposed).slice(0, 300)}”`);
  }
  const label = (d: AutoFixDecision) => (d.kind === "phrase" ? `\`${d.id}\` line` : d.kind === "quote" ? `fact \`${d.id}\` quote${d.beat ? ` for \`${d.beat}\`` : ""}` : `fact \`${d.id}\` claim`);
  const skipped = autoFixDecisions.filter((d) => d.status === "skipped");
  if (skipped.length) {
    out.push("", "## Automatic rewrites not applied", "");
    for (const d of skipped) out.push(`- ${label(d)}: ${cell(d.proposed).slice(0, 200) || "–"} — ${cell(d.reason ?? "skipped")}`);
  }

  out.push("", "## Rubric", "", "| Id | Criterion | Self | Judge | Cap | Score | Note |", "|---|---|---|---|---|---|---|");
  for (const c of rubric.criteria) {
    const note = [...c.capReasons, c.why].filter(Boolean).join("; ");
    out.push(`| ${c.id} | ${cell(c.name)}${c.weight === 2 ? " ×2" : ""} | ${c.self} | ${c.judge ?? "–"} | ${c.cap} | ${c.effective} | ${cell(note).slice(0, 240)} |`);
  }
  const gates = rubric.gates.map((g) => `${g.ok ? "ok" : g.hard ? "FAIL" : "warn"} ${g.id}: ${g.msg}`);
  out.push("", ...gates.map((g) => `- ${g}`));
  if (rubric.floorsFailed.length) out.push(`- below floor: ${rubric.floorsFailed.join(", ")}`);

  if (review) {
    out.push("", "## Stills review", "", `- round ${review.round} · checked ${review.checked.join(", ") || "–"}`);
    if (!review.issues.length) out.push("- no issues reported");
    for (const i of review.issues) out.push(`- \`${i.beat}\` ${i.status}: ${cell(i.issue)}${i.fix ? ` → ${cell(i.fix)}` : ""}`);
  }

  out.push("", "## Lints", "");
  if (!lint.results.length) out.push("- none");
  const order = { block: 0, error: 1, warn: 2 } as const;
  for (const r of [...lint.results].sort((a, b) => order[a.severity] - order[b.severity])) out.push(`- ${r.severity.toUpperCase()} ${r.id}${r.beatId ? ` ${r.beatId}` : ""}: ${r.message}`);
  return out.join("\n") + "\n";
}
