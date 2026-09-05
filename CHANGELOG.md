# Changelog

This file documents the changes made in this fork after it diverged from the
original Skylight project.

## 2026-09-03 — Geographic flight-follow mode

### Added

- Added a new projector mode selector:
  - **Local** preserves the original fixed-location sky/radar visualization.
  - **Follow flight** displays a geographic map centered on a selected aircraft.
- Added an OpenStreetMap-based flight-follow display.
- Added adjustable follow-map zoom.
- Added nearby aircraft suggestions from the currently available feed.
- Added global live-aircraft search when an aircraft is not available locally.
- Added search by:
  - Flight number
  - ICAO callsign
  - Registration or tail number
  - ICAO aircraft hex
- Added IATA flight-number resolution for searches such as `AC1664`.
- Added airborne and on-ground status badges to flight-search results.
- Added configurable motion controls:
  - Interpolation
  - Smoothing
  - Maximum extrapolation
  - Aircraft removal timeout
  - Maximum frame rate
- Added automated tests for flight search and aircraft/map motion.

### Changed

- The aircraft API polling area now follows the selected aircraft as it travels.
- Nearby aircraft and labels interpolate between incoming position updates.
- The selected aircraft and map camera use continuous motion instead of snapping
  to every received position.
- Projector flight following remains separate from the optional PTZ camera-tracker
  subsystem.

### Fixed

- Fixed the flight suggestion dropdown briefly opening and then disappearing
  when the aircraft feed refreshed.
- Fixed nearby aircraft and callsigns jumping between feed updates.
- Reduced map-camera shaking at higher zoom levels.
- Reduced small camera reversals caused by delayed or noisy aircraft positions.
- Ignored invalid callsigns such as `0` and `00000000`.
- Improved identification fallback using registration or ICAO hex when a valid
  callsign is unavailable.

## 2026-08-22 — Public ADS-B providers and API reliability

### Added

- Added configurable public ADS-B endpoints:
  - `API_URL` for nearby aircraft
  - `FLIGHT_LOOKUP_URL` for global lookup
  - `GROUND_API_URL` for airport ground traffic
- Added configurable `API_USER_AGENT` and `GROUND_USER_AGENT` identifiers.
- Added a shared request gate for controlling outbound API request frequency.
- Added request priorities so primary aircraft updates take priority over
  supplemental ground-traffic requests.
- Added cooldown handling following HTTP `429` rate-limit responses.
- Added tests for API request spacing, priority, and backoff behavior.

### Changed

- Changed the default nearby-aircraft provider to `adsb.fi`.
- Changed the default airport-ground provider to `adsb.lol`.
- Increased the default aircraft polling interval to reduce unnecessary requests.
- Reduced airport-ground polling to once per minute.
- Kept separate request gates when aircraft and ground data use different providers.

## 2026-08-20 — Configurable ground traffic and Pi setup

### Added

- Added airport surface-traffic polling for the currently configured airport.
- Added live aircraft positions to the airport ground/runway panel.
- Added taxiing-aircraft identification and callsign display.
- Added API-only Raspberry Pi installation as the default setup.
- Added optional RTL-SDR and `dump1090` installation with:

  ```bash
  ENABLE_RADIO=1 LAT=<latitude> LON=<longitude> ./pi-setup/install-on-pi.sh
  ```

### Changed

- Replaced the original SFO-specific ground-traffic implementation with a
  configurable airport implementation.
- Ground traffic now follows the airport selected in Skylight's configuration.
- Updated server and WebSocket messages from SFO-specific naming to generic
  airport-ground naming.
- The Raspberry Pi service defaults to `DATA_SOURCE=api`.
- The Pi installer automatically selects `DATA_SOURCE=radio` when radio support
  is explicitly enabled.
- Removed the server service's hard dependency on `dump1090`, allowing it to
  start normally in API-only installations.
