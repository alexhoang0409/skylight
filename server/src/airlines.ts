// Airline name lookup by ICAO callsign prefix, backed by the OpenFlights
// public airline dataset (Open Database License). Downloaded on first use
// and cached on disk for a month, same pattern as airports.ts.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const MAX_AGE_MS = 30 * 24 * 3600_000;

async function cachedDat(dataDir: string): Promise<string> {
  const dir = join(dataDir, "openflights");
  const path = join(dir, "airlines.dat");
  let fresh = false;
  try {
    fresh = Date.now() - (await stat(path)).mtimeMs < MAX_AGE_MS;
  } catch {
    /* not downloaded yet */
  }
  if (!fresh) {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await mkdir(dir, { recursive: true });
      await writeFile(path, text);
      return text;
    } catch (e) {
      console.error("[airlines] OpenFlights download failed:", e);
    }
  }
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Error("airline database download failed — check the server's internet access");
  }
}

/** One CSV line -> fields, honoring quotes. Same parser style as airports.ts. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface AirlineIndex {
  nameByIcao: Map<string, string>;
  icaoByIata: Map<string, string>;
}

/** airlines.dat has no header row; columns are fixed by position:
 *  0 id, 1 name, 2 alias, 3 IATA, 4 ICAO, 5 callsign, 6 country, 7 active */
export function buildAirlineIndex(text: string): AirlineIndex {
  const nameByIcao = new Map<string, string>();
  const icaoByIata = new Map<string, string>();
  const activeIata = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const name = f[1];
    const iata = f[3];
    const icao = f[4];
    if (icao && icao !== "\\N" && name && name !== "\\N") {
      nameByIcao.set(icao.toUpperCase(), name);
    }
    if (iata && iata !== "\\N" && icao && icao !== "\\N") {
      const iataKey = iata.toUpperCase();
      const active = f[7]?.toUpperCase() === "Y";
      // OpenFlights contains retired duplicates. Prefer an active carrier,
      // otherwise keep the first stable mapping rather than the last row.
      if (!icaoByIata.has(iataKey) || (active && !activeIata.has(iataKey))) {
        icaoByIata.set(iataKey, icao.toUpperCase());
        if (active) activeIata.add(iataKey);
      }
    }
  }
  return { nameByIcao, icaoByIata };
}

let cache: AirlineIndex | null = null;

async function getIndex(dataDir: string): Promise<AirlineIndex> {
  if (!cache) cache = buildAirlineIndex(await cachedDat(dataDir));
  return cache;
}

/** Convert a marketed IATA flight number (AC1664) to the ICAO callsign
 * broadcast over ADS-B (ACA1664). Already-ICAO and unknown values pass
 * through unchanged. */
export function expandIataCallsign(input: string, index: AirlineIndex): string {
  const normalized = input.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^([A-Z0-9]{2})(\d+[A-Z]?)$/);
  if (!match) return normalized;
  const icao = index.icaoByIata.get(match[1]);
  return icao ? `${icao}${match[2]}` : normalized;
}

export async function resolveIataCallsign(
  input: string,
  dataDir: string,
): Promise<string> {
  return expandIataCallsign(input, await getIndex(dataDir));
}

/** Resolve a callsign's operating airline from its ICAO prefix (e.g. the
 *  first 3 letters of "SWA808" -> "Southwest Airlines"). Returns null on
 *  no match rather than guessing. */
export async function lookupAirlineByCallsign(
  callsign: string,
  dataDir: string,
): Promise<string | null> {
  const prefix = callsign.trim().toUpperCase().match(/^[A-Z]{3}/)?.[0];
  if (!prefix) return null;
  return (await getIndex(dataDir)).nameByIcao.get(prefix) ?? null;
}
