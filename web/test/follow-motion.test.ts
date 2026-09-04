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
    // Skylight may poll four times while the upstream feed still returns the
    // exact same position. Repeated coordinates must not become fake fixes.
    model.update([aircraft({ lon: 0 })], 500);
    model.update([aircraft({ lon: 0 })], 1_000);
    model.update([aircraft({ lon: 0 })], 1_500);
    model.update([aircraft({ lon: 2 })], 2_000);

    // The measured 2 s cadence produces a 2.1 s render buffer. At 3.1 s,
    // render time is exactly halfway between the two known fixes.
    expect(model.frame(3_100, OPTIONS)[0].lon).toBeCloseTo(1, 6);
    expect(model.frame(3_600, OPTIONS)[0].lon).toBeCloseTo(1.5, 6);
  });

  it("uses provider age and retains stable identity metadata", () => {
    const model = new FollowMotionModel();
    model.update([aircraft({ lon: 0, flight: "ACA1664" })], 0);
    model.update([aircraft({ lon: 2, flight: undefined, seen: 0.5 })], 2_500);

    // The second coordinate was observed at t=2 s, not when fetched at 2.5 s.
    const halfway = model.frame(3_100, OPTIONS)[0];
    expect(halfway.lon).toBeCloseTo(1, 6);
    expect(halfway.flight).toBe("ACA1664");
  });

  it("bases its render clock only on the followed aircraft and changes it gradually", () => {
    const model = new FollowMotionModel();
    const target = (lon: number) => aircraft({ hex: "target", lon });
    const nearby = (lon: number) => aircraft({ hex: "nearby", lon });
    const options = { ...OPTIONS, followedHex: "target" };

    model.update([target(0), nearby(0)], 0);
    model.frame(0, options);
    // A nearby receiver updates much faster, while the followed plane's real
    // coordinate changes on its normal two-second cadence.
    model.update([target(0), nearby(0.5)], 500);
    model.frame(500, options);
    model.update([target(0), nearby(1)], 1_000);
    model.frame(1_000, options);
    model.update([target(0), nearby(1.5)], 1_500);
    model.frame(1_500, options);
    model.update([target(2), nearby(2)], 2_000);
    model.frame(2_000, options);

    // At 3.1 s the target should be around the middle of its real segment.
    // Using nearby intervals would move the render clock and put it near the
    // newest coordinate instead, causing the camera pulse seen at refresh.
    const rendered = model.frame(3_100, options).find((ac) => ac.hex === "target")!;
    expect(rendered.lon).toBeGreaterThan(0.8);
    expect(rendered.lon).toBeLessThan(1.2);
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
