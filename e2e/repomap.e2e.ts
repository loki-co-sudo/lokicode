// Cheap (no-API) integration check for the repository map (P2): builds the map
// over THIS real repo through the shimmed grep_search and asserts it captured
// known symbols. Runs under the e2e config (not `npm test`) but costs nothing.

import { describe, it, expect } from "vitest";
import { buildRepoMap } from "../src/lib/repoMap";

describe("buildRepoMap over the real repo", () => {
  it("captures known definitions from src/lib with file:line", async () => {
    const map = await buildRepoMap(process.cwd() + "/src/lib");
    // Known exported functions in this codebase must appear, grouped under files.
    expect(map).toMatch(/reasoning\.ts/);
    expect(map).toMatch(/runRecurrentReasoning/);
    expect(map).toMatch(/agent\.ts/);
    expect(map).toMatch(/runAgent/);
    expect(map).toMatch(/repoMap\.ts/);
    // Lines are prefixed with "  <n>: " (line-numbered symbol entries).
    expect(map).toMatch(/\n {2}\d+: /);
    console.log(`\n[repomap] ${map.length} chars\n${map.slice(0, 1500)}\n…`);
  });
});
