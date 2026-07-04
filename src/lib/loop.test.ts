import { describe, it, expect } from "vitest";
import { LOOP_MAX_ATTEMPTS, errorSignature, evidenceTail } from "./loop";

describe("errorSignature", () => {
  it("treats runs differing only in numbers/whitespace as the same failure", () => {
    const a = "FAIL src/lib/cost.test.ts > estimates\n  expected 3 to be 4\nDuration 1.24s";
    const b = "FAIL src/lib/cost.test.ts > estimates\n  expected 7 to be 9\nDuration  12.9s";
    expect(errorSignature(a)).toBe(errorSignature(b));
  });

  it("distinguishes genuinely different failures", () => {
    const a = "error TS2304: Cannot find name 'foo'";
    const b = "error TS2551: Property 'bar' does not exist";
    expect(errorSignature(a)).not.toBe(errorSignature(b));
  });

  it("compares on the tail so a long unchanged preamble can't mask a new error", () => {
    const preamble = "x".repeat(2000);
    expect(errorSignature(preamble + " errA")).not.toBe(errorSignature(preamble + " errB"));
  });
});

describe("evidenceTail", () => {
  it("returns the last non-empty lines", () => {
    expect(evidenceTail("a\n\nb\nc\n", 2)).toBe("b\nc");
  });
});

describe("LOOP_MAX_ATTEMPTS", () => {
  it("is capped at 5 per the loop development rule", () => {
    expect(LOOP_MAX_ATTEMPTS).toBe(5);
  });
});
