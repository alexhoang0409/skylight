import { describe, expect, it } from "vitest";
import { findAircraftByIdentity, type Aircraft } from "../src/index.js";

const AIRCRAFT: Aircraft[] = [
  { hex: "c01001", flight: "ACA1664", registration: "C-FABC" },
  { hex: "a02002", flight: "UAL42", registration: "N12345" },
];

describe("findAircraftByIdentity", () => {
  it("matches a live callsign, tail number, or ICAO hex", () => {
    expect(findAircraftByIdentity(AIRCRAFT, "aca 1664")?.hex).toBe("c01001");
    expect(findAircraftByIdentity(AIRCRAFT, "AC1664")?.hex).toBe("c01001");
    expect(findAircraftByIdentity(AIRCRAFT, "c-fabc")?.hex).toBe("c01001");
    expect(findAircraftByIdentity(AIRCRAFT, "A02002")?.hex).toBe("a02002");
  });

  it("does not guess when there is no unique live match", () => {
    expect(findAircraftByIdentity(AIRCRAFT, "missing")).toBeNull();
    expect(
      findAircraftByIdentity(
        [...AIRCRAFT, { hex: "c01004", flight: "AMX1664" }],
        "AC1664",
      )?.hex,
    ).toBe("c01001");
    expect(
      findAircraftByIdentity(
        [...AIRCRAFT, { hex: "c01003", flight: "ACA1664" }],
        "ACA1664",
      ),
    ).toBeNull();
  });
});
