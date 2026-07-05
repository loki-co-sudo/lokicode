import { describe, it, expect } from "vitest";
import { runVerifyLoop, buildFixPrompt, type VerifyDeps } from "./verifyLoop";

interface Script {
  results: { code: number; stdout?: string; stderr?: string }[];
}

function makeDeps(script: Script) {
  const events: string[] = [];
  const reports: string[] = [];
  const fixes: string[] = [];
  let i = 0;
  const deps: VerifyDeps = {
    exec: async () => {
      const r = script.results[Math.min(i++, script.results.length - 1)];
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code };
    },
    fix: async (p) => {
      fixes.push(p);
      events.push("fix");
    },
    onCommandStart: () => events.push("start"),
    onCommandEnd: (ok) => events.push(ok ? "ok" : "fail"),
    report: (m) => reports.push(m),
  };
  return { deps, events, reports, fixes };
}

describe("runVerifyLoop", () => {
  it("passes immediately and quotes the output tail as evidence", async () => {
    const { deps, reports, fixes } = makeDeps({
      results: [{ code: 0, stdout: "line1\nTests 51 passed" }],
    });
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("passed");
    expect(fixes).toHaveLength(0);
    expect(reports[0]).toContain("✅");
    expect(reports[0]).toContain("Tests 51 passed"); // evidence, not just a claim
    expect(reports[0]).toContain("試行 1/5");
  });

  it("fixes a failure then passes (change→verify→fix loop)", async () => {
    const { deps, fixes } = makeDeps({
      results: [{ code: 1, stderr: "error TS2304: Cannot find name 'foo'" }, { code: 0, stdout: "built" }],
    });
    const out = await runVerifyLoop("npm run build", 5, deps);
    expect(out).toBe("passed");
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toContain("TS2304");
    expect(fixes[0]).toContain("弱体化"); // no-test-weakening rule travels with the log
  });

  it("stops when the same normalized error repeats (stuck detection)", async () => {
    const { deps, reports, fixes } = makeDeps({
      // Same failure with different incidental numbers → same signature.
      results: [
        { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
        { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
      ],
    });
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("stuck");
    expect(fixes).toHaveLength(1); // fixed once, then the repeat stopped the loop
    expect(reports[0]).toContain("🛑");
  });

  it("exhausts the attempt budget on persistent distinct failures", async () => {
    const { deps, reports } = makeDeps({
      results: [
        { code: 1, stderr: "error A" },
        { code: 1, stderr: "error B totally different" },
        { code: 1, stderr: "error C something else" },
      ],
    });
    const out = await runVerifyLoop("npm test", 3, deps);
    expect(out).toBe("exhausted");
    expect(reports[0]).toContain("⚠️");
    expect(reports[0]).toContain("3 回");
  });

  it("reports exec-error when the command itself cannot run", async () => {
    const { reports } = { reports: [] as string[] };
    const out = await runVerifyLoop("npm test", 3, {
      exec: async () => {
        throw new Error("spawn failed");
      },
      fix: async () => {},
      onCommandStart: () => {},
      onCommandEnd: (_ok, log) => reports.push(log),
      report: () => {},
    });
    expect(out).toBe("exec-error");
    expect(reports[0]).toContain("spawn failed");
  });

  it("respects abort before exec and before fix", async () => {
    let aborted = false;
    const { deps } = makeDeps({ results: [{ code: 1, stderr: "e" }] });
    const out = await runVerifyLoop("npm test", 5, {
      ...deps,
      aborted: () => aborted || ((aborted = true), false), // abort after first check
    });
    expect(out).toBe("aborted");
  });
});

describe("buildFixPrompt", () => {
  it("clips very long logs around the middle", () => {
    const log = "H".repeat(4000) + "MIDDLE" + "T".repeat(4000);
    const p = buildFixPrompt("npm test", log);
    expect(p).toContain("…(中略)…");
    expect(p).not.toContain("MIDDLE");
    expect(p.length).toBeLessThan(7000);
  });
});
