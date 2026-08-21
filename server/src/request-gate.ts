export interface RequestGateOptions {
  /** Minimum time between requests, in ms. */
  minIntervalMs: number;
  /** Cooldown applied after an HTTP 429, in ms. */
  backoffMs: number;
}

export class RequestGate {
  private lastRequestAt = 0;
  private cooldownUntil = 0;

  constructor(private readonly opts: RequestGateOptions) {}

  /** Wait until a request is allowed under the shared gate. */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.cooldownUntil - now, this.lastRequestAt + this.opts.minIntervalMs - now);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
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
