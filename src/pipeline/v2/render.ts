// Slim renderer seam (hackathon fork): the types + error the v3 render core needs. The Lambda renderer and the
// Discord bot pipeline that lived here were removed; scripts/reel.ts injects a LOCAL Remotion renderer.
export const ORCHESTRATOR_RESERVE_SEC = 900;

// ── renderer seam (tests inject a fake) ─────────────────────────────────────────────────────────────────────────────

export interface MediaRequest {
  serveUrl: string;
  composition: string;
  inputProps: Record<string, unknown>;
  framesPerLambda: number;
  outFile: string;
  onProgress?: (fraction: number, detail: string) => void;
  signal?: AbortSignal;
  /** Remotion's per-chunk timeoutInMilliseconds (default 30 000, the v2 value; the v3 render passes 120 000). */
  timeoutMs?: number;
}
export interface MediaResult {
  /** Remotion's estimatedPrice.accruedSoFar (renderer chunks only). */
  costUsd: number;
  /** Remotion's timeToFinish (s), else the wall. */
  renderSec: number;
  lambdasInvoked?: number;
  retries?: number;
}
/** A render that failed after it started; carries Remotion's accrued cost when one came back. */
export class MediaRenderError extends Error {
  constructor(
    message: string,
    readonly accruedUsd: number | null,
    readonly aborted = false,
  ) {
    super(message);
    this.name = "MediaRenderError";
  }
}
export type MediaRenderer = (req: MediaRequest) => Promise<MediaResult>;
