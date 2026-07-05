import { describe, it, expect } from "vitest";
import { parseNeedsExec } from "./reasoning";

describe("parseNeedsExec", () => {
  it("parses a clean one-word verdict", () => {
    expect(parseNeedsExec("YES")).toBe(true);
    expect(parseNeedsExec("no")).toBe(false);
    expect(parseNeedsExec("はい")).toBe(true);
    expect(parseNeedsExec("いいえ")).toBe(false);
  });

  it("takes the LAST verdict when the model rambles (e2e-observed failure)", () => {
    // A stray "yes" inside the reasoning must not flip an analysis question
    // onto the execute path.
    expect(
      parseNeedsExec(
        "Yes, the request mentions files, but it only asks to organize information. " +
          "Reading files is not a system change. Final answer: NO",
      ),
    ).toBe(false);
    expect(parseNeedsExec("It seems no changes at first, but a commit is required: YES")).toBe(
      true,
    );
  });

  it("defaults to NO (safe read-only analysis path) when unparseable", () => {
    expect(parseNeedsExec("")).toBe(false);
    expect(parseNeedsExec("わかりません")).toBe(false);
  });

  it("does not false-match inside words", () => {
    expect(parseNeedsExec("nothing to do here")).toBe(false); // "no" in "nothing" must not count
  });
});
