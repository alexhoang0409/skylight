import { useEffect, useMemo, useRef, useState } from "react";
import type { Aircraft, Config } from "@shared/index.js";
import {
  formatAltitude,
  formatLatLon,
  formatSpeed,
} from "@shared/index.js";
import type { AmbientMode } from "../lib/useAmbientMode.js";

const TILE_SIZE = 256;
const MAX_MERCATOR_LAT = 85.05112878;
const TRAIL_MAX_POINTS = 360;

interface Point {
  x: number;
  y: number;
}

interface TrailPoint {
  lat: number;
  lon: number;
  at: number;
}

interface MapTile {
  key: string;
  url: string;
  left: number;
  top: number;
}

function worldPoint(lat: number, lon: number, zoom: number): Point {
  const size = TILE_SIZE * 2 ** zoom;
  const safeLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function screenPoint(
  lat: number,
  lon: number,
  center: Point,
  zoom: number,
  width: number,
  height: number,
): Point {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const point = worldPoint(lat, lon, zoom);
  let dx = point.x - center.x;
  if (dx > worldSize / 2) dx -= worldSize;
  if (dx < -worldSize / 2) dx += worldSize;
  return { x: width / 2 + dx, y: height / 2 + point.y - center.y };
}

function mapTiles(
  center: Point,
  zoom: number,
  width: number,
  height: number,
): MapTile[] {
  const tileCount = 2 ** zoom;
  const minX = Math.floor((center.x - width / 2) / TILE_SIZE) - 1;
  const maxX = Math.floor((center.x + width / 2) / TILE_SIZE) + 1;
  const minY = Math.max(0, Math.floor((center.y - height / 2) / TILE_SIZE) - 1);
  const maxY = Math.min(
    tileCount - 1,
    Math.floor((center.y + height / 2) / TILE_SIZE) + 1,
  );
  const tiles: MapTile[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        left: x * TILE_SIZE - center.x + width / 2,
        top: y * TILE_SIZE - center.y + height / 2,
      });
    }
  }
  return tiles;
}

function useViewport(ref: React.RefObject<HTMLDivElement>): { width: number; height: number } {
  const [size, setSize] = useState({
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function planePath(size: number): string {
  const s = size;
  return [
    `M 0 ${-1.25 * s}`,
    `C ${0.12 * s} ${-1.05 * s}, ${0.15 * s} ${-0.55 * s}, ${0.16 * s} ${-0.2 * s}`,
    `L ${1.05 * s} ${0.38 * s}`,
    `L ${1.03 * s} ${0.58 * s}`,
    `L ${0.16 * s} ${0.28 * s}`,
    `L ${0.13 * s} ${0.9 * s}`,
    `L ${0.48 * s} ${1.12 * s}`,
    `L ${0.46 * s} ${1.25 * s}`,
    `L 0 ${1.1 * s}`,
    `L ${-0.46 * s} ${1.25 * s}`,
    `L ${-0.48 * s} ${1.12 * s}`,
    `L ${-0.13 * s} ${0.9 * s}`,
    `L ${-0.16 * s} ${0.28 * s}`,
    `L ${-1.03 * s} ${0.58 * s}`,
    `L ${-1.05 * s} ${0.38 * s}`,
    `L ${-0.16 * s} ${-0.2 * s}`,
    `C ${-0.15 * s} ${-0.55 * s}, ${-0.12 * s} ${-1.05 * s}, 0 ${-1.25 * s}`,
    "Z",
  ].join(" ");
}

function flightName(ac: Aircraft, fallback: string): string {
  const callsign = ac.flight?.trim();
  return (callsign && !/^0+$/.test(callsign) ? callsign : undefined) ||
    ac.registration || ac.hex.toUpperCase() || fallback;
}

export function FollowMap({
  aircraft,
  config,
  connected,
  now,
  ambient,
  isKiosk,
}: {
  aircraft: Aircraft[];
  config: Config;
  connected: boolean;
  now: number;
  ambient: AmbientMode;
  isKiosk: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewport(rootRef);
  const followed = config.followedFlight;
  const liveTarget = followed
    ? aircraft.find((ac) => ac.hex === followed.hex && ac.lat != null && ac.lon != null) ?? null
    : null;
  const [lastTarget, setLastTarget] = useState<Aircraft | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  useEffect(() => {
    setLastTarget(null);
    setTrail([]);
  }, [followed?.hex]);

  useEffect(() => {
    if (!liveTarget || liveTarget.lat == null || liveTarget.lon == null) return;
    setLastTarget(liveTarget);
    setTrail((points) => {
      const next = { lat: liveTarget.lat!, lon: liveTarget.lon!, at: now || Date.now() };
      const previous = points[points.length - 1];
      if (previous && previous.lat === next.lat && previous.lon === next.lon) return points;
      return [...points, next].slice(-TRAIL_MAX_POINTS);
    });
  }, [liveTarget, now]);

  const savedTarget: Aircraft | null = followed
    ? {
        hex: followed.hex,
        flight: followed.label,
        lat: followed.lat,
        lon: followed.lon,
      }
    : null;
  const target = liveTarget ?? lastTarget ?? savedTarget;
  const zoom = Math.max(4, Math.min(14, Math.round(config.followMapZoom)));
  const center = useMemo(
    () =>
      target?.lat != null && target.lon != null
        ? worldPoint(target.lat, target.lon, zoom)
        : null,
    [target?.lat, target?.lon, zoom],
  );
  const tiles = useMemo(
    () =>
      center
        ? mapTiles(center, zoom, viewport.width, viewport.height)
        : [],
    [center, zoom, viewport.width, viewport.height],
  );

  const projectedTrail = useMemo(
    () =>
      center
        ? trail.map((point) =>
            screenPoint(
              point.lat,
              point.lon,
              center,
              zoom,
              viewport.width,
              viewport.height,
            ),
          )
        : [],
    [trail, center, zoom, viewport.width, viewport.height],
  );

  const nearby = useMemo(() => {
    if (!center || !followed) return [];
    return aircraft
      .filter(
        (ac) =>
          ac.hex !== followed.hex && ac.lat != null && ac.lon != null,
      )
      .map((ac) => ({
        ac,
        point: screenPoint(
          ac.lat!,
          ac.lon!,
          center,
          zoom,
          viewport.width,
          viewport.height,
        ),
      }))
      .filter(
        ({ point }) =>
          point.x >= -40 &&
          point.x <= viewport.width + 40 &&
          point.y >= -40 &&
          point.y <= viewport.height + 40,
      );
  }, [aircraft, center, followed, zoom, viewport.width, viewport.height]);

  const routePoint =
    center && target?.destLat != null && target.destLon != null
      ? screenPoint(
          target.destLat,
          target.destLon,
          center,
          zoom,
          viewport.width,
          viewport.height,
        )
      : null;
  const targetPoint = { x: viewport.width / 2, y: viewport.height / 2 };
  const alt = target ? target.altBaro ?? target.altGeom : null;
  const track = target?.track ?? 0;

  return (
    <div ref={rootRef} className="follow-map-root">
      {center ? (
        <>
          <div className="follow-map-tiles" aria-hidden="true">
            {tiles.map((tile) => (
              <img
                key={tile.key}
                src={tile.url}
                alt=""
                width={TILE_SIZE}
                height={TILE_SIZE}
                draggable={false}
                style={{ left: tile.left, top: tile.top }}
              />
            ))}
          </div>
          <div className="follow-map-shade" />
          <svg className="follow-map-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
            {routePoint && (
              <line
                className="follow-route-line"
                x1={targetPoint.x}
                y1={targetPoint.y}
                x2={routePoint.x}
                y2={routePoint.y}
              />
            )}
            {projectedTrail.length > 1 && (
              <polyline
                className="follow-trail"
                points={projectedTrail.map((point) => `${point.x},${point.y}`).join(" ")}
              />
            )}
            {nearby.map(({ ac, point }) => (
              <g
                key={ac.hex}
                className="nearby-aircraft"
                transform={`translate(${point.x} ${point.y}) rotate(${ac.track ?? 0})`}
              >
                <path d={planePath(5)} />
                <text transform={`rotate(${-(ac.track ?? 0)})`} x={9} y={4}>
                  {flightName(ac, ac.hex.toUpperCase())}
                </text>
              </g>
            ))}
            <g
              className={`follow-aircraft ${liveTarget ? "live" : "stale"}`}
              transform={`translate(${targetPoint.x} ${targetPoint.y}) rotate(${track})`}
            >
              <circle r="34" />
              <path d={planePath(13)} />
            </g>
          </svg>

          <aside className="follow-flight-card">
            <div className="follow-eyebrow">
              <span className={`follow-live-dot ${liveTarget && connected ? "live" : "stale"}`} />
              {liveTarget && connected ? "Following live" : "Last known position"}
            </div>
            <h1>{target ? flightName(target, followed?.label ?? target.hex) : followed?.label}</h1>
            {(target?.airline || target?.typeName) && (
              <p className="follow-subtitle">{[target.airline, target.typeName].filter(Boolean).join(" · ")}</p>
            )}
            {(target?.origin || target?.destination) && (
              <div className="follow-route">
                <span>{target.origin ?? "—"}</span>
                <span className="follow-route-arrow">→</span>
                <span>{target.destination ?? "—"}</span>
              </div>
            )}
            <dl>
              {alt != null && (
                <div><dt>Altitude</dt><dd>{formatAltitude(alt, config.altitudeUnit)}</dd></div>
              )}
              {target?.gs != null && (
                <div><dt>Speed</dt><dd>{formatSpeed(target.gs, config.speedUnit)}</dd></div>
              )}
              {target?.track != null && (
                <div><dt>Heading</dt><dd>{Math.round(target.track)}°</dd></div>
              )}
              {target?.registration && (
                <div><dt>Tail</dt><dd>{target.registration}</dd></div>
              )}
            </dl>
          </aside>

          {target?.lat != null && target.lon != null && (
            <div className="follow-coordinates">
              {formatLatLon(target.lat, target.lon)} · z{zoom}
            </div>
          )}
          <div className="map-attribution">
            © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
          </div>
        </>
      ) : (
        <div className="follow-waiting">
          <div className="follow-waiting-orbit"><span /></div>
          <div className="follow-eyebrow">Flight map</div>
          <h1>{followed ? `Waiting for ${followed.label}` : "Choose a live flight"}</h1>
          <p>
            {followed
              ? "The map will start as soon as this aircraft reports a position."
              : "Open the control page, select Follow flight, and enter a live callsign or tail number."}
          </p>
        </div>
      )}

      {!connected && <div className="reconnect">connecting…</div>}
      {!isKiosk && (
        <button
          type="button"
          className={`ambient-toggle ${ambient.active ? "on" : ""}`}
          onClick={() => ambient.toggle()}
          aria-label="Toggle ambient fullscreen mode"
        >
          {ambient.active ? "◱ exit ambient" : "◳ ambient"}
        </button>
      )}
    </div>
  );
}
