// On-demand global aircraft acquisition for projector follow mode. This is
// deliberately separate from the area's continuous poller: a user search is
// one rate-limited request, then normal area polling follows the selected hex.

import type {
  FlightSearchKind,
  FlightSearchResponse,
} from "@shared/index.js";
import { normalizeAircraft, type RawAircraft } from "./datasource.js";
import type { RequestGate } from "./request-gate.js";

export class FlightSearchError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "FlightSearchError";
  }
}

export interface FlightSearchOptions {
  baseUrl: string;
  userAgent: string;
  requestGate: RequestGate;
  resolveCallsign: (query: string) => Promise<string>;
}

function normalizeQuery(input: string): string {
  const query = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{2,16}$/.test(query)) {
    throw new FlightSearchError(
      "Use a flight number, callsign, registration, or six-character ICAO hex.",
      400,
    );
  }
  return query;
}

function registrationLike(query: string): boolean {
  return query.includes("-") || /^N\d[A-Z0-9]*$/.test(query);
}

async function fetchMatches(
  kind: FlightSearchKind,
  value: string,
  options: FlightSearchOptions,
): Promise<FlightSearchResponse> {
  await options.requestGate.waitForSlot("high");
  const url = `${options.baseUrl.replace(/\/$/, "")}/${kind}/${encodeURIComponent(value)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": options.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Global flight search timed out. Try again."
      : "Global flight search is temporarily unavailable.";
    throw new FlightSearchError(message);
  }

  if (response.status === 429) {
    options.requestGate.markRateLimited();
    throw new FlightSearchError("Flight-data provider is rate limited. Try again shortly.", 429);
  }
  if (response.status === 404) {
    return { query: value, resolvedQuery: value, matchedBy: kind, aircraft: [] };
  }
  if (!response.ok) {
    throw new FlightSearchError(`Flight-data provider returned HTTP ${response.status}.`);
  }

  const body = await response.json() as {
    ac?: RawAircraft[];
    aircraft?: RawAircraft[];
  };
  const at = Date.now();
  const byHex = new Map(
    (body.ac ?? body.aircraft ?? [])
      .map((raw) => normalizeAircraft(raw, at))
      .filter((aircraft) => aircraft !== null)
      .map((aircraft) => [aircraft.hex, aircraft]),
  );
  return {
    query: value,
    resolvedQuery: value,
    matchedBy: kind,
    aircraft: [...byHex.values()],
  };
}

/** Search the provider globally without broad area scans. */
export async function searchLiveAircraft(
  input: string,
  options: FlightSearchOptions,
): Promise<FlightSearchResponse> {
  const query = normalizeQuery(input);
  const looksLikeCallsign = /^[A-Z]{2,3}\d+[A-Z]?$/.test(query);

  // Airline flight numbers such as AC1664 are also valid-looking six-digit
  // hexadecimal strings. Prefer callsign resolution for that familiar shape;
  // most bare ICAO addresses (for example C01001 or A12BCD) remain unambiguous.
  if (/^[0-9A-F]{6}$/.test(query) && !looksLikeCallsign) {
    return fetchMatches("hex", query, options);
  }
  if (registrationLike(query)) {
    return fetchMatches("registration", query, options);
  }

  let resolvedQuery = query;
  try {
    resolvedQuery = await options.resolveCallsign(query);
  } catch {
    // Airline database unavailable: an already-ICAO callsign still works.
  }
  const result = await fetchMatches("callsign", resolvedQuery, options);
  return { ...result, query, resolvedQuery };
}
