import { describe, it, expect } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("parses the four classes", () => {
    expect(parseRoute("trivial")).toBe("trivial");
    expect(parseRoute("agent")).toBe("agent");
    expect(parseRoute("deep")).toBe("deep");
    expect(parseRoute("deep-hard")).toBe("deep-hard");
  });

  it("matches deep-hard before deep (substring can't shadow it)", () => {
    expect(parseRoute("Deep-Hard")).toBe("deep-hard");
    expect(parseRoute("deep_hard")).toBe("deep-hard");
    expect(parseRoute("deep hard")).toBe("deep-hard");
  });

  it("tolerates surrounding prose", () => {
    expect(parseRoute("The classification is: deep.")).toBe("deep");
    expect(parseRoute("答え: trivial")).toBe("trivial");
  });

  it("falls back to agent on anything unrecognized", () => {
    expect(parseRoute("")).toBe("agent");
    expect(parseRoute("unsure")).toBe("agent");
  });
});
