import { describe, it, expect } from "vitest";
import { gradeCitations, gradeExit, gradeEdits, gradeForbidden, gradeCalls } from "./graders";

describe("gradeCitations", () => {
  const files: Record<string, string> = { "a.ts": "l1\nl2\nl3\n" };
  const reader = async (p: string) => files[p] ?? null;

  it("passes when there are no citations at all", async () => {
    const r = await gradeCitations("no citations here", reader);
    expect(r).toEqual({ name: "citations", ok: true, detail: "citations: 0 (none cited)" });
  });

  it("passes when every citation resolves", async () => {
    const r = await gradeCitations("see a.ts:2 for details", reader);
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("1/1 valid");
  });

  it("fails and lists invalid citations when a path is fake", async () => {
    const r = await gradeCitations("see fake.ts:2 and a.ts:2", reader);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("1/2 valid");
    expect(r.detail).toContain("fake.ts:2(not-found)");
  });
});

describe("gradeExit", () => {
  it("passes when the exit code matches the expectation", () => {
    expect(gradeExit(0).ok).toBe(true);
    expect(gradeExit(0, 0).ok).toBe(true);
  });
  it("fails when the exit code differs", () => {
    const r = gradeExit(1, 0);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("exit=1 expected=0");
  });
});

describe("gradeEdits", () => {
  it("passes trivially when no edits are expected", () => {
    expect(gradeEdits([], new Set()).ok).toBe(true);
  });
  it("passes when every expected path was changed", () => {
    const r = gradeEdits(["a.ts", "b.ts"], new Set(["a.ts", "b.ts", "c.ts"]));
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("all 2 edited");
  });
  it("fails and names the missing paths when one expected edit did not happen", () => {
    const r = gradeEdits(["a.ts", "b.ts"], new Set(["a.ts"]));
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("missing: b.ts");
  });
});

describe("gradeForbidden", () => {
  it("passes trivially when nothing is forbidden", () => {
    expect(gradeForbidden([], new Set(["a.ts"])).ok).toBe(true);
  });
  it("passes when none of the forbidden paths were touched", () => {
    const r = gradeForbidden(["secret.env"], new Set(["a.ts"]));
    expect(r.ok).toBe(true);
  });
  it("fails and names the violated paths when a forbidden path was touched", () => {
    const r = gradeForbidden(["secret.env", "b.ts"], new Set(["secret.env", "a.ts"]));
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("violated: secret.env");
  });
});

describe("gradeCalls", () => {
  it("always passes and reports the total with no baseline", () => {
    const r = gradeCalls([{ phase: "judge", calls: 5 }], null);
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("calls=5 (no baseline)");
  });
  it("reports a positive delta against the previous run", () => {
    const r = gradeCalls(
      [{ phase: "judge", calls: 8 }],
      [{ phase: "judge", calls: 5 }],
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("calls=8 (prev=5, Δ+3)");
  });
  it("reports a negative delta against the previous run", () => {
    const r = gradeCalls(
      [{ phase: "judge", calls: 3 }],
      [{ phase: "judge", calls: 5 }],
    );
    expect(r.detail).toBe("calls=3 (prev=5, Δ-2)");
  });
});
