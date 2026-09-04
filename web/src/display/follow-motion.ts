import type { Aircraft } from "@shared/index.js";

const EARTH_RADIUS_M = 6_371_000;
const KNOT_TO_MPS = 0.514444;
// The server polls every two seconds by default. Start with that cadence so
// the first measured interval does not make the animation jump backward.
const INITIAL_RENDER_DELAY_MS = 2_100;
const MIN_RENDER_DELAY_MS = 750;
const MAX_RENDER_DELAY_MS = 2_500;
const MAX_FIXES = 12;

interface MotionFix {
  at: number;
  lat: number;
  lon: number;
  track?: number;
  gs?: number;
}

interface MotionTrack {
  aircraft: Aircraft;
  fixes: MotionFix[];
  lastSeenAt: number;
}

interface DisplayedPosition {
  lat: number;
  lon: number;
  track?: number;
  at: number;
}

export interface FollowMotionOptions {
  interpolate: boolean;
  smoothing: number;
  maxExtrapolationSec: number;
  staleSec: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeLongitude(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

function longitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function interpolateAngle(from: number | undefined, to: number | undefined, t: number): number | undefined {
  if (from == null) return to;
  if (to == null) return from;
  return (from + longitudeDelta(from, to) * t + 360) % 360;
}

function interpolateFix(a: MotionFix, b: MotionFix, t: number): MotionFix {
  return {
    at: a.at + (b.at - a.at) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    lon: normalizeLongitude(a.lon + longitudeDelta(a.lon, b.lon) * t),
    track: interpolateAngle(a.track, b.track, t),
    gs: b.gs ?? a.gs,
  };
}

/** Advance a geographic fix along its reported ground track. */
function extrapolateFix(fix: MotionFix, seconds: number): MotionFix {
  if (fix.track == null || fix.gs == null || fix.gs <= 0 || seconds <= 0) return fix;
  const angularDistance = fix.gs * KNOT_TO_MPS * seconds / EARTH_RADIUS_M;
  const bearing = fix.track * Math.PI / 180;
  const lat1 = fix.lat * Math.PI / 180;
  const lon1 = fix.lon * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    ...fix,
    at: fix.at + seconds * 1000,
    lat: lat2 * 180 / Math.PI,
    lon: normalizeLongitude(lon2 * 180 / Math.PI),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Position-history model for the geographic follow map. It buffers roughly
 * one feed interval so motion is interpolated between real fixes, then uses a
 * short, bounded extrapolation only when the next snapshot is late.
 */
export class FollowMotionModel {
  private tracks = new Map<string, MotionTrack>();
  private displayed = new Map<string, DisplayedPosition>();
  private fixIntervals: number[] = [];

  update(aircraft: Aircraft[], at: number): void {
    for (const ac of aircraft) {
      if (ac.lat == null || ac.lon == null) continue;
      const existing = this.tracks.get(ac.hex);
      const track: MotionTrack = existing ?? {
        aircraft: ac,
        fixes: [],
        lastSeenAt: at,
      };
      // Identity fields can temporarily disappear from aggregator snapshots.
      // Keep the last useful values so a callsign never flickers into a hex.
      track.aircraft = {
        ...ac,
        flight: ac.flight ?? existing?.aircraft.flight,
        registration: ac.registration ?? existing?.aircraft.registration,
        typeCode: ac.typeCode ?? existing?.aircraft.typeCode,
        typeName: ac.typeName ?? existing?.aircraft.typeName,
      };
      track.lastSeenAt = at;
      const lastFix = track.fixes[track.fixes.length - 1];
      const samePosition = lastFix?.lat === ac.lat && lastFix.lon === ac.lon;
      if (samePosition) {
        // The Pi can poll faster than the upstream position feed. Restamping a
        // repeated coordinate as a new fix makes the plane sit still and then
        // cover the entire distance in one short refresh interval.
        lastFix.track = ac.track ?? lastFix.track;
        lastFix.gs = ac.gs ?? lastFix.gs;
      } else {
        const seenSeconds = Number.isFinite(ac.seen)
          ? clamp(ac.seen ?? 0, 0, 60)
          : 0;
        const observedAt = at - seenSeconds * 1000;
        const fixAt = lastFix ? Math.max(lastFix.at + 1, observedAt) : observedAt;
        if (lastFix) {
          const interval = fixAt - lastFix.at;
          if (interval >= 250 && interval <= 10_000) {
            this.fixIntervals.push(interval);
            this.fixIntervals = this.fixIntervals.slice(-32);
          }
        }
        track.fixes.push({
          at: fixAt,
          lat: ac.lat,
          lon: ac.lon,
          track: ac.track,
          gs: ac.gs,
        });
        track.fixes = track.fixes.slice(-MAX_FIXES);
      }
      this.tracks.set(ac.hex, track);
    }
  }

  private renderDelayMs(): number {
    const interval = median(this.fixIntervals);
    return interval == null
      ? INITIAL_RENDER_DELAY_MS
      : clamp(interval * 1.05, MIN_RENDER_DELAY_MS, MAX_RENDER_DELAY_MS);
  }

  private desiredPosition(track: MotionTrack, renderAt: number, options: FollowMotionOptions): MotionFix {
    const fixes = track.fixes;
    const first = fixes[0];
    const last = fixes[fixes.length - 1];
    if (!options.interpolate) return last;
    if (renderAt <= first.at) return first;

    for (let index = 1; index < fixes.length; index++) {
      const before = fixes[index - 1];
      const after = fixes[index];
      if (renderAt <= after.at) {
        const amount = (renderAt - before.at) / Math.max(1, after.at - before.at);
        return interpolateFix(before, after, amount);
      }
    }

    const seconds = Math.min(
      Math.max(0, options.maxExtrapolationSec),
      Math.max(0, (renderAt - last.at) / 1000),
    );
    return extrapolateFix(last, seconds);
  }

  frame(at: number, options: FollowMotionOptions): Aircraft[] {
    const renderAt = at - (options.interpolate ? this.renderDelayMs() : 0);
    const smoothing = clamp(options.smoothing, 0, 0.99);
    const staleMs = Math.max(1, options.staleSec) * 1000;
    const result: Aircraft[] = [];

    for (const [hex, track] of this.tracks) {
      if (at - track.lastSeenAt > staleMs) {
        this.tracks.delete(hex);
        this.displayed.delete(hex);
        continue;
      }

      const desired = this.desiredPosition(track, renderAt, options);
      const previous = this.displayed.get(hex);
      let position: DisplayedPosition;
      if (!previous || smoothing === 0) {
        position = { ...desired, at };
      } else {
        // Smoothing is expressed as a time constant so its feel is independent
        // of display refresh rate. The default 0.18 settles in roughly 0.5 s.
        const tauMs = 80 + smoothing * 2_200;
        const elapsedMs = clamp(at - previous.at, 0, 1_000);
        const amount = 1 - Math.exp(-elapsedMs / tauMs);
        position = {
          at,
          lat: previous.lat + (desired.lat - previous.lat) * amount,
          lon: normalizeLongitude(
            previous.lon + longitudeDelta(previous.lon, desired.lon) * amount,
          ),
          track: interpolateAngle(previous.track, desired.track, amount),
        };
      }
      this.displayed.set(hex, position);
      result.push({
        ...track.aircraft,
        lat: position.lat,
        lon: position.lon,
        track: position.track ?? track.aircraft.track,
      });
    }
    return result;
  }
}
