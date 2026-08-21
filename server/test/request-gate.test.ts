import { describe, expect, it } from "vitest";
import { RequestGate } from "../src/request-gate.js";

describe("RequestGate", () => {
  it("enforces a minimum interval across requests", async () => {
    const gate = new RequestGate({ minIntervalMs: 1000, backoffMs: 2000 });
    const startedAt = Date.now();

    await gate.waitForSlot();
    const first = Date.now();
    await gate.waitForSlot();
    const second = Date.now();

    expect(first - startedAt).toBeGreaterThanOrEqual(0);
    expect(second - first).toBeGreaterThanOrEqual(900);
  });

  it("applies a cooldown after a 429 response", () => {
    const gate = new RequestGate({ minIntervalMs: 100, backoffMs: 500 });
    const now = Date.now();
    gate.markRateLimited(now);

    expect(gate.nextAllowedAt()).toBeGreaterThanOrEqual(now + 500);
  });
});
