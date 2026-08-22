export interface RequestGateOptions {
  /** Minimum time between requests, in ms. */
  minIntervalMs: number;
  /** Cooldown applied after an HTTP 429, in ms. */
  backoffMs: number;
}

export type RequestPriority = "high" | "normal";

interface PendingRequest {
  priority: RequestPriority;
  resolve: () => void;
}

export class RequestGate {
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  private pending: PendingRequest[] = [];
  private pumping = false;

  constructor(private readonly opts: RequestGateOptions) {}

  /** Queue a request and grant aircraft/API work before lower-priority work. */
  waitForSlot(priority: RequestPriority = "normal"): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({ priority, resolve });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0) {
        const now = Date.now();
        const waitMs = Math.max(
          0,
          this.cooldownUntil - now,
          this.lastRequestAt + this.opts.minIntervalMs - now,
        );
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        const highPriorityIndex = this.pending.findIndex(
          (request) => request.priority === "high",
        );
        const request = this.pending.splice(
          highPriorityIndex >= 0 ? highPriorityIndex : 0,
          1,
        )[0];
        this.lastRequestAt = Date.now();
        request.resolve();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Apply the provider cooldown after a 429 or similar rate-limit response. */
  markRateLimited(at = Date.now()): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, at + this.opts.backoffMs);
    this.lastRequestAt = Math.max(this.lastRequestAt, at);
  }

  nextAllowedAt(): number {
    const now = Date.now();
    return Math.max(this.lastRequestAt + this.opts.minIntervalMs, this.cooldownUntil, now);
  }
}
