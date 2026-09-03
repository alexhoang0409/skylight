import { describe, expect, it } from "vitest";
import type { Aircraft } from "@shared/index.js";
import { FollowMotionModel, type FollowMotionOptions } from "../src/display/follow-motion.js";

const OPTIONS: FollowMotionOptions = {
  interpolate: true,
  smoothing: 0,
  maxExtrapolationSec: 5,
  staleSec: 20,
};

function aircraft(over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: "c01001",
    lat: 0,
    lon: 0,
    track: 90,
    gs: 240,
    onGround: false,
    ...over,
  };
}

describe("FollowMotionModel", () => {
  it("interpolates continuously between buffered provider snapshots", () => {
    const model = new FollowMotionModel();
    model.update([aircraft({ lon: 0 })], 0);
    model.update([aircraft({ lon: 2 })], 2_000);

    // The measured 2 s cadence produces a 2.1 s render buffer. At 3.1 s,
    // render time is exactly halfway between the two known fixes.
    expect(model.frame(3_100, OPTIONS)[0].lon).toBeCloseTo(1, 6);
    expect(model.frame(3_600, OPTIONS)[0].lon).toBeCloseTo(1.5, 6);
  });

  it("takes the shortest path across the date line and through north", () => {
    const model = new FollowMotionModel();
    model.update([aircraft({ lon: 179, track: 350 })], 0);
    model.update([aircraft({ lon: -179, track: 10 })], 2_000);

    const halfway = model.frame(3_100, OPTIONS)[0];
    expect(Math.abs(halfway.lon)).toBeCloseTo(180, 6);
    expect(halfway.track === 0 || halfway.track === 360).toBe(true);
  });

  it("dead-reckons briefly when a new fix is late", () => {
    const model = new FollowMotionModel();
    model.update([aircraft({ lat: 0, lon: 0, track: 90, gs: 360 })], 0);

    // Initial buffer is 2.1 s, leaving one second of bounded extrapolation.
    const projected = model.frame(3_100, OPTIONS)[0];
    expect(projected.lat).toBeCloseTo(0, 5);
    expect(projected.lon).toBeGreaterThan(0.001);
  });

  it("eases corrections according to the smoothing setting", () => {
    const model = new FollowMotionModel();
    const smooth = { ...OPTIONS, interpolate: false, smoothing: 0.5 };
    model.update([aircraft({ lon: 0 })], 0);
    expect(model.frame(0, smooth)[0].lon).toBe(0);

    model.update([aircraft({ lon: 10 })], 1_000);
    const firstCorrection = model.frame(1_016, smooth)[0].lon!;
    const secondCorrection = model.frame(1_032, smooth)[0].lon!;
    expect(firstCorrection).toBeGreaterThan(0);
    expect(firstCorrection).toBeLessThan(10);
    expect(secondCorrection).toBeGreaterThan(firstCorrection);
  });

  it("drops tracks only after the configured stale interval", () => {
    const model = new FollowMotionModel();
    model.update([aircraft()], 0);
    expect(model.frame(4_999, { ...OPTIONS, staleSec: 5 })).toHaveLength(1);
    expect(model.frame(5_001, { ...OPTIONS, staleSec: 5 })).toHaveLength(0);
  });
});
