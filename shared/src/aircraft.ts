// Normalized aircraft model. The server maps both dump1090 (`aircraft.json`)
// and the airplanes.live API into this single shape so the renderer never
// cares where the data came from.

export interface Aircraft {
  /** 24-bit ICAO address — the stable key for everything. */
  hex: string;
  /** Callsign, trimmed (e.g. "UAL1234"). */
  flight?: string;

  lat?: number;
  lon?: number;
  /** Barometric altitude in feet, or null when on ground. */
  altBaro?: number | null;
  /** Geometric altitude in feet. */
  altGeom?: number | null;
  /** Ground speed, knots. */
  gs?: number;
  /** Track / heading over ground, degrees. */
  track?: number;
  /** Vertical rate, ft/min (positive = climbing). */
  baroRate?: number | null;
  squawk?: string;
  category?: string;
  onGround?: boolean;

  /** Registration (dump1090 `r`). */
  registration?: string;
  /** ICAO type code, e.g. "B738" (dump1090 `t`). */
  typeCode?: string;

  /** Seconds since the last message for this aircraft (from the source). */
  seen?: number;
  /** Signal strength, dBFS (radio only). */
  rssi?: number;

  // --- enrichment (filled server-side) ---
  /** Human type name, e.g. "Boeing 737-800". */
  typeName?: string;
  airline?: string;
  origin?: string;
  destination?: string;
  /** Destination/origin city + coordinates (for ghost arcs + local time). */
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;

  /** Server timestamp (ms) of the snapshot this fix came from. */
  ts?: number;
}

/** A single broadcast snapshot of the current sky. */
export interface AircraftSnapshot {
  /** Server time (ms epoch) the snapshot was produced. */
  now: number;
  aircraft: Aircraft[];
}

/**
 * Resolve an identity entered in the projector control UI against aircraft
 * that are live right now. Callsigns ignore spaces ("AC 1664" matches
 * "AC1664"); registrations and ICAO hex values are case-insensitive.
 * Ambiguous identities deliberately return null so we never follow the wrong
 * aircraft.
 */
export function findAircraftByIdentity(
  aircraft: Aircraft[],
  identity: string,
): Aircraft | null {
  const query = identity.trim().toUpperCase();
  const compactQuery = query.replace(/\s+/g, "");
  if (!query) return null;

  const matches = aircraft.filter((ac) => {
    const hex = ac.hex.trim().toUpperCase();
    const flight = ac.flight?.trim().toUpperCase().replace(/\s+/g, "");
    const registration = ac.registration?.trim().toUpperCase();
    return hex === query || flight === compactQuery || registration === query;
  });
  if (matches.length > 0) return matches.length === 1 ? matches[0] : null;

  // ADS-B normally carries an ICAO callsign (ACA1664), while people often
  // enter its IATA flight number (AC1664). Without guessing an airline-code
  // conversion, accept a unique live flight whose ICAO prefix begins with
  // the entered letters and has the same numeric suffix. Ambiguity still
  // fails closed.
  const shorthand = compactQuery.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/);
  if (!shorthand) return null;
  const shorthandMatches = aircraft.filter((ac) => {
    const live = ac.flight?.trim().toUpperCase().replace(/\s+/g, "");
    const parsed = live?.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/);
    return parsed?.[1].startsWith(shorthand[1]) && parsed?.[2] === shorthand[2];
  });
  return shorthandMatches.length === 1 ? shorthandMatches[0] : null;
}
