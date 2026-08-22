// Airport surface traffic from an area API — feeds the "who's taxiing / who's
// next" panel on the TV and the Twitch stream. The local receiver rarely hears
// surface targets 13 mi away at ground level, so this comes from an aggregator.
//
// Polite polling: ground traffic is supplemental, so refresh it much less often
// than the aircraft feed. Failures skip the tick and keep the last snapshot.

import type { GroundAircraft } from "@shared/index.js";
import type { Airport } from "@shared/airport.js";
import { RequestGate } from "./request-gate.js";

const RADIUS_NM = 3;
const POLL_MS = Number(process.env.GROUND_POLL_MS ?? 60_000);
const USER_AGENT =
  process.env.GROUND_USER_AGENT ??
  "skylight/0.1 (https://github.com/alexhoang0409/skylight)";

/** Raw readsb-style aircraft record (the fields we read). */
interface AlAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  category?: string;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
}

export interface AirportGroundPollerOptions {
  /** Area URL template using {lat}, {lon}, and {r} placeholders. */
  apiUrlTemplate: string;
  getAirport: () => Airport;
  onUpdate: (at: number, aircraft: GroundAircraft[]) => void;
  requestGate: RequestGate;
}

export class AirportGroundPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: { at: number; aircraft: GroundAircraft[] } | null = null;
  private lastErrorLogAt = 0;
  private readonly requestGate: RequestGate;

  constructor(private opts: AirportGroundPollerOptions) {
    this.requestGate = opts.requestGate;
  }

  /** Latest snapshot for late-joining clients (null until first success). */
  getSnapshot(): { at: number; aircraft: GroundAircraft[] } | null {
    return this.last;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    try {
      const airport = this.opts.getAirport();
      const url = this.opts.apiUrlTemplate
        .replace("{lat}", String(airport.lat))
        .replace("{lon}", String(airport.lon))
        .replace("{r}", String(RADIUS_NM));
      await this.requestGate.waitForSlot("normal");
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        if (res.status === 429) {
          this.requestGate.markRateLimited();
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { ac?: AlAircraft[] };
      const aircraft: GroundAircraft[] = [];
      for (const a of body.ac ?? []) {
        if (a.alt_baro !== "ground") continue;
        if (a.lat == null || a.lon == null || !a.hex) continue;
        // Surface VEHICLES are ADS-B category C; TIS-B tracks with no
        // identity at all are almost always vehicles too. Keep aircraft.
        if (a.category?.startsWith("C")) continue;
        if (!a.t && !a.flight && !a.r) continue;
        aircraft.push({
          hex: a.hex,
          flight: a.flight?.trim() || undefined,
          reg: a.r,
          typeCode: a.t,
          lat: a.lat,
          lon: a.lon,
          trackDeg: a.track,
          gsKt: a.gs,
        });
      }
      const at = Date.now();
      this.last = { at, aircraft };
      this.opts.onUpdate(at, aircraft);
    } catch (err) {
      // Quietly tolerant: log at most once a minute.
      const now = Date.now();
      if (now - this.lastErrorLogAt > 60_000) {
        this.lastErrorLogAt = now;
        console.warn(`[airport-ground] poll failed: ${(err as Error).message}`);
      }
    }
  }
}
