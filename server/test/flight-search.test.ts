import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLiveAircraft, FlightSearchError } from "../src/flight-search.js";
import { RequestGate } from "../src/request-gate.js";

function options(resolveCallsign = async (query: string) => query) {
  return {
    baseUrl: "https://aircraft.example/v2/",
    userAgent: "skylight-test",
    requestGate: new RequestGate({ minIntervalMs: 0, backoffMs: 0 }),
    resolveCallsign,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("searchLiveAircraft", () => {
  it("converts an IATA flight number and normalizes the global result", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ac: [{
          hex: "c01001",
          flight: "ACA1664 ",
          lat: 45.2,
          lon: -73.1,
          alt_baro: 31_000,
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await searchLiveAircraft(
      "AC1664",
      options(async () => "ACA1664"),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://aircraft.example/v2/callsign/ACA1664",
      expect.objectContaining({ headers: { "User-Agent": "skylight-test" } }),
    );
    expect(result.query).toBe("AC1664");
    expect(result.resolvedQuery).toBe("ACA1664");
    expect(result.aircraft[0]).toMatchObject({
      hex: "c01001",
      flight: "ACA1664",
      lat: 45.2,
      altBaro: 31_000,
    });
  });

  it("uses direct endpoints for registrations and ICAO hex values", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ac: [] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    expect((await searchLiveAircraft("C-FABC", options())).matchedBy).toBe("registration");
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/registration/C-FABC");

    expect((await searchLiveAircraft("C01001", options())).matchedBy).toBe("hex");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/hex/C01001");
  });

  it("rejects malformed input without contacting the provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(searchLiveAircraft("../../etc", options())).rejects.toMatchObject({
      status: 400,
    } satisfies Partial<FlightSearchError>);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces provider rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(searchLiveAircraft("ACA1664", options())).rejects.toMatchObject({
      status: 429,
    } satisfies Partial<FlightSearchError>);
  });
});
