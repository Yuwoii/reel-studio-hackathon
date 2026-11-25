// DataField presets (amendments §3a, R7 §2–§3). Pure and deterministic: content is a function of
// (seed, preset, row, cell, tick) via remotion random(); nothing uses Math.random.
//
// Two layouts:
//  - "text": monospace rows on a fixed pitch (hex, logs, process, matrix, book). A row is a list of segments; rollable
//    segments re-roll in place at a FIXED width, so a re-roll never shifts the row. Lead segments (address, timestamp,
//    PID) render in textFainter.
//  - "grid": glyph lattices (nodes, lattice) on a square pitch; rollable cells are labels / crosshairs.
// Texture data uses documentation ranges only: IPv4 RFC 5737, IPv6 RFC 3849, private ASNs 64512–65534.
import { random } from "remotion";
import { field, type } from "../theme";
import { fieldClockMs, type FieldPresetId } from "../../../src/v2/fieldFamilies";

/** Preset ids: ONE list in src/v2/fieldFamilies.ts (FIELD_PRESET_IDS; theme.field.presets predates `certs`). */
export type PresetId = FieldPresetId;

/** Per-row context the layer passes in (pure function of the storyboard). */
export interface RowCtx {
  /** Log clock origin, ms since midnight (storyboard time hint, see fieldClock()). */
  clockMs?: number;
}

export interface Seg {
  text: string;
  lead?: boolean;
  /** Same-width regenerator for re-rolls (absent = static). */
  roll?: (rnd: (k: string) => number) => string;
}

interface Common {
  id: PresetId;
  size: number;
  pitch: number;
  /** Content drift in world px/s (negative y = up). */
  scroll: { x: number; y: number };
  /** Body glyph alpha (white) when the preset needs a dimmer base than textFaint (0.15). Lead segments stay
   *  textFainter (0.07). W3.1: dense presets (logs) read too bright at 0.15 (measured ≈0.16 effective over bg). */
  bodyAlpha?: number;
}
export interface TextPreset extends Common {
  layout: "text";
  charW: number;
  row: (r: number, cols: number, rnd: (k: string) => number, ctx?: RowCtx) => Seg[];
}
export interface GridPreset extends Common {
  layout: "grid";
  glyph: string;
  /** Alternate glyph a re-rolled cell snaps to (lattice). */
  rollGlyph?: string;
  /** Label (textFainter) for node (i, j), or null. Labels are the rollable cells when present. */
  label?: (i: number, j: number, rnd: (k: string) => number) => string | null;
  /** Probability of a link to the right / down neighbour (nodes). */
  linkP?: number;
  /** Baseline trace every n px (lattice). */
  traceEveryPx?: number;
}
export type FieldPreset = TextPreset | GridPreset;

const HEX = "0123456789abcdef";
const pick = <T,>(arr: readonly T[], u: number): T => arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
const hexN = (rnd: (k: string) => number, n: number, k: string) => Array.from({ length: n }, (_, j) => HEX[Math.floor(rnd(`${k}:${j}`) * 16)]).join("");
const pad = (s: string, n: number, left = false) => (s.length >= n ? s.slice(0, n) : left ? s.padStart(n, " ") : s.padEnd(n, " "));
const docIp = (u: number, v: number) => `${pick(["192.0.2", "198.51.100", "203.0.113"], u)}.${1 + Math.floor(v * 254)}`;
const privAsn = (u: number) => `AS${64512 + Math.floor(u * 1023)}`;

/** Fill `cols` characters by repeating `block(b)` segment lists (each block returns segments for block index b). */
function fillBlocks(cols: number, block: (b: number) => Seg[], sep = "  "): Seg[] {
  const out: Seg[] = [];
  let used = 0;
  for (let b = 0; used < cols && b < 200; b++) {
    if (b > 0) {
      out.push({ text: sep });
      used += sep.length;
    }
    for (const s of block(b)) {
      out.push(s);
      used += s.text.length;
    }
  }
  return out;
}

const hex: TextPreset = {
  id: "hex", layout: "text", size: type.field.size, pitch: 50, charW: type.field.size * 0.6, scroll: { x: 0, y: -field.scrollPxPerS },
  row: (r, cols, rnd) => {
    const addr = (0x7f0000 + ((r * 0x20) & 0xffff)).toString(16).padStart(6, "0");
    const segs: Seg[] = [{ text: `0x${addr}`, lead: true }, { text: " " }];
    for (let g = 0, used = 9; used < cols; g++, used += 5) {
      segs.push({ text: " " });
      const k = `g${g}`;
      segs.push({ text: hexN(rnd, 4, k), roll: (r2) => hexN(r2, 4, k) });
    }
    return segs;
  },
};

const LEVELS = ["INFO ", "INFO ", "INFO ", "INFO ", "INFO ", "DEBUG", "WARN "] as const;
const HOSTS = ["lb-euw2b", "api-03  ", "edge-7  ", "ingest-1", "auth-02 ", "queue-4 ", "db-ro-2 "] as const;
/** Logs clock origin when the storyboard gives no time hint (06:23:00, the pre-W3.1 constant). */
export const LOGS_DEFAULT_CLOCK_MS = (6 * 3600 + 23 * 60) * 1000;
/** Row pitch in log time: rows are ~0.4 s apart (+ < 0.4 s jitter), so ~2.5 rows per second of story. */
export const LOGS_ROW_MS = 412;
/** Rows above the clock origin: the hint time sits this many rows into the field, so the camera's opening rows read
 *  a little BEFORE the hinted moment and the field crosses it as the reel moves down the world. */
export const LOGS_LEAD_ROWS = 12;
/** W3.1 (carry-over minor "logs preset"): body alpha inside R7's 0.07–0.10 field band (was textFaint 0.15). */
export const LOGS_BODY_ALPHA = 0.09;

/** Log timestamp (HH:MM:SS.mmm) of row r. Monotonic in r. No hint → the pre-W3.1 clock (row 0 = 06:23:00); a hint
 *  (ms since midnight) puts that time LOGS_LEAD_ROWS rows into the field. */
export function logTimestamp(r: number, rnd: (k: string) => number, clockMs?: number): string {
  const t = clockMs === undefined ? LOGS_DEFAULT_CLOCK_MS + r * LOGS_ROW_MS : clockMs + (r - LOGS_LEAD_ROWS) * LOGS_ROW_MS;
  const ms = (((t + Math.floor(rnd("t0") * 400)) % 86_400_000) + 86_400_000) % 86_400_000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(ms / 3600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, "0")}`;
}

/** Clock origin for a field seed: "slug@HH:MM[:SS]" → that time (ms since midnight), else undefined (default clock). */
export function fieldClock(seed: string): number | undefined {
  return fieldClockMs(seed) ?? undefined;
}

const logs: TextPreset = {
  id: "logs", layout: "text", size: type.fieldLog.size, pitch: 44, charW: type.fieldLog.size * 0.6, scroll: { x: 0, y: -field.scrollPxPerS }, bodyAlpha: LOGS_BODY_ALPHA,
  row: (r, cols, rnd, ctx) => {
    // monotonic: rows are ~0.4 s apart with a per-row jitter smaller than the step (a log reads top → bottom in time)
    const ts = logTimestamp(r, rnd, ctx?.clockMs);
    const segs: Seg[] = [{ text: ts, lead: true }, { text: "  " }, { text: pick(LEVELS, rnd("lvl")) }, { text: "  " }, { text: pick(HOSTS, rnd("host")) }];
    let used = 12 + 2 + 5 + 2 + 8;
    for (let k = 0; used < cols; k++) {
      const ip = docIp(rnd(`ip${k}`), rnd(`ipv${k}`));
      const a = `  upstream=${pad(`${ip}:8080`, 20)} `;
      const rt = (r2: (x: string) => number) => `rt=${String(Math.floor(r2(`rt${k}`) * 900) + 4).padStart(3, "0")}ms`;
      const st = (r2: (x: string) => number) => pick(["200", "200", "200", "204", "304", "201"], r2(`st${k}`));
      const by = (r2: (x: string) => number) => `bytes=${String(Math.floor(r2(`by${k}`) * 99999)).padStart(5, "0")}`;
      const rq = (r2: (x: string) => number) => `req=${hexN(r2, 8, `rq${k}`)}`;
      segs.push({ text: a }, { text: rt(rnd), roll: rt }, { text: " " }, { text: st(rnd), roll: st }, { text: " " }, { text: by(rnd), roll: by }, { text: " " }, { text: rq(rnd), roll: rq });
      used += a.length + 8 + 1 + 3 + 1 + 11 + 1 + 12;
    }
    return segs;
  },
};

const USERS = ["www-data", "postgres", "node    ", "root    ", "redis   ", "app     "] as const;
/** ≤ 15 chars each (the COMMAND slot of a 54-char process block). */
const CMDS = ["php-fpm: pool", "postgres", "node server.js", "containerd-shim", "redis-server", "nginx: worker", "kubelet", "java -jar app"] as const;
/** Process block = 54 chars (972 px at charW 18) ≈ one station width (960). W2.1: the 74-char block (cmd padded to 32)
 *  put block ends wherever the second station column's frame edge fell, so the left edge at the cgroup/loop stations
 *  (world x ≈ 960–970) cut COMMAND tails ("him", "*:6379", "iter"). With a ≈ station-width period the frame edge of
 *  every station column lands in the 2-char separator just before the next right-aligned PID, so rows start whole.
 *  Columns (ps aux-like, compact): PID(5) ␣␣ USER(8) ␣ %CPU(4) ␣ %MEM(4) ␣␣ TIME(8) ␣␣ COMMAND(≤15) + separator. */
export const PROCESS_BLOCK_CHARS = 54;
const PROCESS_SEP = "  ";
const PROCESS_CMD_W = PROCESS_BLOCK_CHARS - (5 + 2 + 8 + 1 + 4 + 1 + 4 + 2 + 8 + 2) - PROCESS_SEP.length; // 15
const proc: TextPreset = {
  id: "process", layout: "text", size: type.field.size, pitch: 50, charW: type.field.size * 0.6, scroll: { x: 0, y: -field.scrollPxPerS },
  row: (r, cols, rnd) =>
    fillBlocks(cols, (b) => {
      const k = `b${b}`;
      const pid = pad(String(1000 + Math.floor(rnd(`${k}pid`) * 38000)), 5, true);
      const cpu = (r2: (x: string) => number) => pad((r2(`${k}cpu`) * 99).toFixed(1), 4, true);
      const mem = (r2: (x: string) => number) => pad((r2(`${k}mem`) * 40).toFixed(1), 4, true);
      const time = (r2: (x: string) => number) => {
        const s = Math.floor(r2(`${k}time`) * 86_000);
        return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      };
      return [
        { text: pid, lead: true }, { text: "  " }, { text: pick(USERS, rnd(`${k}u`)) }, { text: " " },
        { text: cpu(rnd), roll: cpu }, { text: " " }, { text: mem(rnd), roll: mem }, { text: "  " }, { text: time(rnd), roll: time }, { text: "  " },
        { text: pad(pick(CMDS, rnd(`${k}c`)), PROCESS_CMD_W) },
      ];
    }, PROCESS_SEP),
};

const matrix: TextPreset = {
  id: "matrix", layout: "text", size: type.field.size, pitch: 50, charW: type.field.size * 0.6, scroll: { x: -field.scrollPxPerS, y: 0 },
  row: (r, cols, rnd) => {
    const segs: Seg[] = [];
    for (let c = 0, used = 0; used < cols; c++, used += 9) {
      const k = `m${c}`;
      const v = (r2: (x: string) => number) => {
        const x = (r2(k) - 0.5) * 2 * (r2(`${k}s`) < 0.15 ? 2.4 : 1.1);
        return pad(x.toFixed(3), 8, true);
      };
      segs.push({ text: v(rnd), roll: v }, { text: " " });
    }
    return segs;
  },
};

const book: TextPreset = {
  id: "book", layout: "text", size: type.field.size, pitch: 50, charW: type.field.size * 0.6, scroll: { x: 0, y: -field.scrollPxPerS },
  row: (r, cols, rnd) =>
    fillBlocks(cols, (b) => {
      const k = `b${b}`;
      const price = (100 + ((((b * 731 - r) % 9000) + 9000) % 9000) / 100).toFixed(2);
      const side = (s: string) => (r2: (x: string) => number) => {
        const q = 100 + Math.floor(r2(`${k}${s}`) * 9900);
        const bar = "=".repeat(1 + Math.floor((q / 10000) * 10));
        const qty = `${Math.floor(q / 1000) ? `${Math.floor(q / 1000)} ` : ""}${String(q % 1000).padStart(Math.floor(q / 1000) ? 3 : 1, "0")}`;
        return s === "bid" ? `${pad(qty, 6, true)} ${pad(bar, 11, true)}` : `${pad(bar, 11)} ${pad(qty, 6)}`;
      };
      const bid = side("bid");
      const ask = side("ask");
      return [{ text: bid(rnd), roll: bid }, { text: "  " }, { text: pad(price, 7, true), lead: true }, { text: "  " }, { text: ask(rnd), roll: ask }, { text: "    " }];
    }),
};

// certs (W3.1): TLS / PKI topics. An openssl-verify-like chain log in blocks of CERTS_BLOCK_CHARS (≈ one station
// width, like process): depth (lead) · serial · subject · notAfter. Documentation names only (example / example.net
// domains, "Example CA n"); no real CA, no real serial. Serials re-roll in place at a fixed width.
export const CERTS_BLOCK_CHARS = 54;
const CERT_SUBJECTS = ["CN=leaf.example", "CN=api.example", "CN=*.example.net", "CN=Example CA 1", "CN=Example CA 2", "CN=Example Int 3", "CN=Example Root X", "O=Example PKI"] as const;
const CERT_SUBJECT_W = 19;
const certSerial = (rnd: (k: string) => number, k: string) => Array.from({ length: 5 }, (_, j) => hexN(rnd, 2, `${k}:${j}`)).join(":"); // 14 chars
const certs: TextPreset = {
  id: "certs", layout: "text", size: type.field.size, pitch: 50, charW: type.field.size * 0.6, scroll: { x: 0, y: -field.scrollPxPerS },
  row: (r, cols, rnd) =>
    fillBlocks(cols, (b) => {
      const k = `b${b}`;
      const depth = Math.floor(rnd(`${k}d`) * 4);
      const serial = (r2: (x: string) => number) => certSerial(r2, `${k}s`);
      const y = 2024 + Math.floor(rnd(`${k}y`) * 6);
      const mo = 1 + Math.floor(rnd(`${k}m`) * 12);
      const day = 1 + Math.floor(rnd(`${k}dd`) * 28);
      const date = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // 3 + 2 + 14 + 2 + 19 + 2 + 10 = 52 (+ 2-char separator = CERTS_BLOCK_CHARS)
      return [
        { text: `d=${depth}`, lead: true }, { text: "  " }, { text: serial(rnd), roll: serial }, { text: "  " },
        { text: pad(pick(CERT_SUBJECTS, rnd(`${k}cn`)), CERT_SUBJECT_W) }, { text: "  " }, { text: date },
      ];
    }),
};

/** nodes: a label owns this many pitch cells (it starts 16 px right of its node, so the next possible label starts
 *  NODE_LABEL_SPAN × pitch further right at the same inset; ≥ 8 px gap between them). */
export const NODE_LABEL_SPAN = 3;
const NODE_LABEL_P = 0.25;
export const NODE_LABEL_MAX_CHARS = Math.floor((NODE_LABEL_SPAN * 100 - 8) / (type.field.size * 0.6)); // 16
/** Raw label draw of cell (i, j). The "l:" keys never re-roll, so a cell's slot is fixed for the whole reel. */
const nodeDraw = (i: number, j: number, rnd: (k: string) => number) => rnd(`l:${i}:${j}`) < NODE_LABEL_P;

const nodes: GridPreset = {
  id: "nodes", layout: "grid", size: type.field.size, pitch: 100, scroll: { x: 0, y: 0 }, glyph: "·", linkP: 0.3,
  // Collision-free by construction (W2 fix: labels overprinted their neighbours): a label owns its cell plus the next
  // NODE_LABEL_SPAN − 1 cells of its row, so a cell only gets one when none of the NODE_LABEL_SPAN − 1 cells to its
  // left drew one (raw draws: local, independent of culling), and its text is clamped to the span. A re-roll only
  // regenerates the text ("lv"/"la"/"l6" keys) in the same slot.
  label: (i, j, rnd) => {
    if (!nodeDraw(i, j, rnd)) return null;
    for (let k = 1; k < NODE_LABEL_SPAN; k++) if (nodeDraw(i - k, j, rnd)) return null;
    const u = rnd(`lv:${i}:${j}`);
    const s = u < 0.5 ? `${pick(["192.0.2", "198.51.100", "203.0.113"], u * 2)}.0/24` : u < 0.8 ? privAsn(rnd(`la:${i}:${j}`)) : `2001:db8:${hexN(rnd, 2, `l6:${i}:${j}`)}::/48`;
    return s.slice(0, NODE_LABEL_MAX_CHARS);
  },
};

const lattice: GridPreset = {
  id: "lattice", layout: "grid", size: type.field.size, pitch: 120, scroll: { x: 0, y: 0 }, glyph: "+", rollGlyph: "×", traceEveryPx: 600,
  label: (i, j) => (((i % 5) + 5) % 5 === 0 && ((j % 5) + 5) % 5 === 0 ? `x ${(i * 0.12).toFixed(2)}  y ${(j * 0.12).toFixed(2)}` : null),
};

export const PRESETS: Record<PresetId, FieldPreset> = { hex, logs, process: proc, matrix, book, nodes, lattice, certs };

/** Seeded random for one row (text) or one lattice (grid). */
export function rowRandom(seed: string, preset: PresetId, r: number, tick: number | string = "base"): (k: string) => number {
  return (k) => random(`${seed}:${preset}:${r}:${k}:${tick}`);
}

/** Every string the field can draw for a preset (glyph allow-list check in tests). */
export function sampleStrings(seed: string, preset: PresetId, rows = 6, cols = 160): string[] {
  const p = PRESETS[preset];
  const out: string[] = [];
  if (p.layout === "text") {
    for (let r = 0; r < rows; r++) {
      const segs = p.row(r, cols, rowRandom(seed, preset, r), { clockMs: fieldClock(seed) });
      out.push(segs.map((s) => s.text).join(""));
      for (const s of segs) if (s.roll) out.push(s.roll(rowRandom(seed, preset, r, 1)));
    }
  } else {
    out.push(p.glyph, p.rollGlyph ?? "");
    for (let i = -10; i < 10; i++) for (let j = -10; j < 10; j++) out.push(p.label?.(i, j, rowRandom(seed, preset, 0)) ?? "");
  }
  return out;
}
