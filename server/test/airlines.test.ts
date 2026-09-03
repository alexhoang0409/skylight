import { describe, expect, it } from "vitest";
import { buildAirlineIndex, expandIataCallsign } from "../src/airlines.js";

const DATA = [
  '1,"Retired Air Canada","\\N","AC","OLD","OLD AIR","Canada","N"',
  '2,"Air Canada","\\N","AC","ACA","AIR CANADA","Canada","Y"',
  '3,"United Airlines","\\N","UA","UAL","UNITED","United States","Y"',
].join("\n");

describe("airline code index", () => {
  const index = buildAirlineIndex(DATA);

  it("prefers active IATA to ICAO mappings", () => {
    expect(index.icaoByIata.get("AC")).toBe("ACA");
    expect(index.nameByIcao.get("ACA")).toBe("Air Canada");
  });

  it("expands marketed flight numbers and preserves ICAO callsigns", () => {
    expect(expandIataCallsign("AC 1664", index)).toBe("ACA1664");
    expect(expandIataCallsign("UAL42", index)).toBe("UAL42");
    expect(expandIataCallsign("ZZ99", index)).toBe("ZZ99");
  });
});
