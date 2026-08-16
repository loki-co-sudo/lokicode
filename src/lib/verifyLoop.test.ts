import { describe, it, expect } from "vitest";
import { runVerifyLoop, buildFixPrompt, type VerifyDeps, type AdvisorStuckContext } from "./verifyLoop";

interface Script {
  results: { code: number; stdout?: string; stderr?: string }[];
}

function makeDeps(script: Script, consultAdvisor?: VerifyDeps["consultAdvisor"]) {
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
    consultAdvisor,
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

describe("runVerifyLoop advisor auto-consult", () => {
  it("consults once on stuck-detection and succeeds after the advice, without touching prevSig incorrectly", async () => {
    const advisorCalls: AdvisorStuckContext[] = [];
    const { deps, events } = makeDeps(
      {
        // Two identical-signature failures trip stuck-detection; the third
        // exec (the advisor's bonus round) passes.
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
          { code: 0, stdout: "built" },
        ],
      },
      async (ctx) => {
        advisorCalls.push(ctx);
        return "check the off-by-one in foo()";
      },
    );
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("passed");
    expect(advisorCalls).toHaveLength(1);
    expect(advisorCalls[0].attempt).toBe(2);
    expect(advisorCalls[0].maxAttempts).toBe(5);
    expect(advisorCalls[0].log).toContain("expected 7 to be 9");
    // exec ran 3 times: attempt1 fail, attempt2 fail (stuck), advisor bonus round pass.
    expect(events.filter((e) => e === "start")).toHaveLength(3);
    // fix() ran twice: the normal post-attempt-1 fix, and the advisor-guided fix.
    expect(events.filter((e) => e === "fix")).toHaveLength(2);
  });

  it("gives the advisor's bonus round a real verify attempt even when maxAttempts is exhausted (the budget bug)", async () => {
    // maxAttempts=2: stuck can only first trip AT attempt 2 (needs two
    // signatures to compare), which would leave zero budget left for a
    // normal retry — the advisor's bonus round must run outside that count.
    const { deps, events } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
          { code: 0, stdout: "built" },
        ],
      },
      async () => "advice",
    );
    const out = await runVerifyLoop("npm test", 2, deps);
    expect(out).toBe("passed");
    expect(events.filter((e) => e === "start")).toHaveLength(3);
  });

  it("gives up (stuck) if the same error persists even after the advisor's bonus round, without consulting twice", async () => {
    const advisorCalls: AdvisorStuckContext[] = [];
    const { deps, reports } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
          { code: 1, stderr: "FAIL expected 1 to be 2 (5ms)" }, // same signature again
        ],
      },
      async (ctx) => {
        advisorCalls.push(ctx);
        return "advice that didn't help";
      },
    );
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("stuck");
    expect(advisorCalls).toHaveLength(1); // never consulted a second time
    expect(reports[reports.length - 1]).toContain("🛑");
    expect(reports[reports.length - 1]).toContain("アドバイザー");
  });

  it("resumes normal looping (not an immediate stuck) when the advice produces a genuinely different error", async () => {
    const { deps, events } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" }, // same sig -> stuck detected
          { code: 1, stderr: "error TS2304: Cannot find name 'bar'" }, // advisor round: different error
          { code: 0, stdout: "built" },
        ],
      },
      async () => "advice",
    );
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("passed");
    expect(events.filter((e) => e === "start")).toHaveLength(4);
    expect(events.filter((e) => e === "fix")).toHaveLength(3);
  });

  it("falls through to the normal stuck report when the advisor returns null", async () => {
    const { deps, reports, fixes } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
        ],
      },
      async () => null,
    );
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("stuck");
    expect(fixes).toHaveLength(1); // only the normal pre-stuck fix; no advisor-guided fix
    expect(reports[0]).toContain("🛑");
  });

  it("reports maxAttempts+1 (not maxAttempts) when exhausted after the advisor's bonus round changed the error", async () => {
    // maxAttempts=2: attempt1 fails, attempt2 repeats it (stuck), advisor's
    // bonus round produces a DIFFERENT error but attempt(2) >= maxAttempts(2)
    // — 3 exec calls actually ran, so the report must say 3, not 2.
    const { deps, reports } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
          { code: 1, stderr: "error TS2304: Cannot find name 'bar'" },
        ],
      },
      async () => "advice",
    );
    const out = await runVerifyLoop("npm test", 2, deps);
    expect(out).toBe("exhausted");
    expect(reports[reports.length - 1]).toContain("⚠️");
    expect(reports[reports.length - 1]).toContain("3 回");
    expect(reports[reports.length - 1]).not.toContain("2 回");
  });

  it("does not consult the advisor when aborted right at the stuck moment", async () => {
    const advisorCalls: AdvisorStuckContext[] = [];
    const { deps } = makeDeps(
      {
        results: [
          { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
          { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
        ],
      },
      async (ctx) => {
        advisorCalls.push(ctx);
        return "advice";
      },
    );
    // aborted() is checked 3 times before the consult gate (top of attempt 1,
    // pre-fix after attempt 1, top of attempt 2) — stay false through those,
    // then trip true exactly at the consult gate.
    let calls = 0;
    const out = await runVerifyLoop("npm test", 5, {
      ...deps,
      aborted: () => ++calls > 3,
    });
    expect(out).toBe("aborted");
    expect(advisorCalls).toHaveLength(0);
  });

  it("never consults when consultAdvisor is not provided (default OFF)", async () => {
    const { deps, reports } = makeDeps({
      results: [
        { code: 1, stderr: "FAIL expected 3 to be 4 (12ms)" },
        { code: 1, stderr: "FAIL expected 7 to be 9 (48ms)" },
      ],
    });
    const out = await runVerifyLoop("npm test", 5, deps);
    expect(out).toBe("stuck");
    expect(reports[0]).not.toContain("アドバイザー");
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
