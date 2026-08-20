// Airport surface panel — "who's next": a mini airport diagram drawn from
// the configured runway geometry with live ground traffic from airplanes.live.

import { useMemo } from "react";
import type { Airport, GroundAircraft } from "@shared/index.js";
import { DEG } from "@shared/index.js";

const M_PER_LAT = 110540;
const EXTENT_M = 2300;
const VIEW = 300;
const TAXI_MIN_KT = 3;

function toXY(airport: Airport, lat: number, lon: number): { x: number; y: number } {
  const metersPerLon = 111320 * Math.cos(airport.lat * DEG);
  const e = (lon - airport.lon) * metersPerLon;
  const n = (lat - airport.lat) * M_PER_LAT;
  return {
    x: VIEW / 2 + (e / EXTENT_M) * (VIEW / 2),
    y: VIEW / 2 - (n / EXTENT_M) * (VIEW / 2),
  };
}

export function AirportGroundPanel(props: {
  airport: Airport;
  ground: { at: number; aircraft: GroundAircraft[] } | null;
}): JSX.Element | null {
  const { airport, ground } = props;
  const runways = useMemo(
    () =>
      airport.runways.map((r) => ({
        a: toXY(airport, r.le[0], r.le[1]),
        b: toXY(airport, r.he[0], r.he[1]),
      })),
    [airport],
  );
  if (!ground) return null;

  const planes = ground.aircraft.filter((a) => {
    const p = toXY(airport, a.lat, a.lon);
    return p.x >= 0 && p.x <= VIEW && p.y >= 0 && p.y <= VIEW;
  });
  const taxiing = planes
    .filter((a) => (a.gsKt ?? 0) >= TAXI_MIN_KT)
    .sort((x, y) => (y.gsKt ?? 0) - (x.gsKt ?? 0));
  const label = (a: GroundAircraft) => a.flight ?? a.reg ?? a.hex;

  return (
    <aside className="tv-ground">
      <div className="tv-ground-title">
        {airport.name} GROUND · {planes.length} AIRCRAFT
      </div>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="tv-ground-map">
        {runways.map((r, i) => (
          <line
            key={i}
            x1={r.a.x}
            y1={r.a.y}
            x2={r.b.x}
            y2={r.b.y}
            className="tv-ground-runway"
          />
        ))}
        {planes.map((a) => {
          const p = toXY(airport, a.lat, a.lon);
          const moving = (a.gsKt ?? 0) >= TAXI_MIN_KT;
          const rot = a.trackDeg ?? 0;
          return (
            <g
              key={a.hex}
              transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
              className={moving ? "tv-ground-ac moving" : "tv-ground-ac"}
            >
              <path
                d="M 0 -4.6 L 3.2 3.8 L 0 1.9 L -3.2 3.8 Z"
                transform={`rotate(${rot.toFixed(0)})`}
              />
              {moving && (
                <text x={5} y={3} className="tv-ground-label">
                  {label(a)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="tv-ground-next">
        {taxiing.length ? (
          <>
            <span className="tv-ground-next-tag">TAXIING</span>
            {taxiing.slice(0, 4).map((a) => (
              <span key={a.hex} className="tv-ground-next-flight">
                {label(a)}
              </span>
            ))}
          </>
        ) : (
          <span className="tv-ground-next-tag idle">APRON QUIET</span>
        )}
      </div>
    </aside>
  );
}