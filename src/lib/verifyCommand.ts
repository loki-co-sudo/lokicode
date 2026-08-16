// Verify-command inference (deepthink-v3-roadmap P10): a run whose executor
// edits files but has no verify command configured finishes with NO
// verification signal at all — not the JUDGE, not a test run (欠陥E). Since a
// missing setting is the failure mode, infer a sensible default from the
// workspace's own manifest files and let the caller offer it as a one-time
// suggestion (never run silently — see reasoning.ts's use of this module).

export interface WorkspaceProbe {
  /** `package.json`'s `scripts` map, or null if missing/unparseable. */
  packageJsonScripts: Record<string, string> | null;
  hasCargoToml: boolean;
  hasPyprojectToml: boolean;
}

/** Priority: package.json test script → package.json build script → Cargo.toml
 * → pyproject.toml → "" (nothing recognized). Pure. */
export function inferVerifyCommand(probe: WorkspaceProbe): string {
  if (probe.packageJsonScripts?.test) return "npm test";
  if (probe.packageJsonScripts?.build) return "npm run build";
  if (probe.hasCargoToml) return "cargo test";
  if (probe.hasPyprojectToml) return "pytest";
  return "";
}

/** Probe the workspace root for the manifest files `inferVerifyCommand` needs,
 * via an injected reader (mirrors `citations.ts`/`evidenceCache.ts` — no Tauri
 * import here, so this stays unit-testable). `readFile` should return null for
 * a missing/unreadable file. */
export async function detectVerifyCommand(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string | null>,
): Promise<string> {
  const at = (name: string) => `${workspaceRoot.replace(/[\\/]+$/, "")}/${name}`;
  const [pkgRaw, cargo, pyproject] = await Promise.all([
    readFile(at("package.json")),
    readFile(at("Cargo.toml")),
    readFile(at("pyproject.toml")),
  ]);
  let packageJsonScripts: Record<string, string> | null = null;
  if (pkgRaw) {
    try {
      const parsed = JSON.parse(pkgRaw) as { scripts?: unknown };
      packageJsonScripts =
        parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)
          ? (parsed.scripts as Record<string, string>)
          : null;
    } catch {
      packageJsonScripts = null;
    }
  }
  return inferVerifyCommand({
    packageJsonScripts,
    hasCargoToml: cargo != null,
    hasPyprojectToml: pyproject != null,
  });
}
