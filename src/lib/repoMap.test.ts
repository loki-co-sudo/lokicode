import { describe, it, expect } from "vitest";
import { SYMBOL_PATTERN, formatRepoMap } from "./repoMap";
import type { SearchMatch } from "./search";

const re = new RegExp(SYMBOL_PATTERN);

describe("SYMBOL_PATTERN", () => {
  it("is a valid JS regex (also valid in the Rust regex crate by construction)", () => {
    expect(() => new RegExp(SYMBOL_PATTERN)).not.toThrow();
  });

  it("matches definition lines across languages", () => {
    const yes = [
      "export function foo() {",
      "  async function bar(x) {",
      "export default class App {",
      "class Widget extends Base {",
      "export interface Opts {",
      "export type Route = string;",
      "  pub fn build(&self) -> String {",
      "fn helper() {",
      "pub struct Config {",
      "enum State {",
      "def solve(self):",
      "  async def fetch(url):",
      "func Handler(w http.ResponseWriter) {",
      "export const runAgent = (msgs) => {",
      "const add = async (a, b) => a + b",
      "export const MAX = 5",
    ];
    for (const line of yes) expect(re.test(line), line).toBe(true);
  });

  it("does not match non-definition lines", () => {
    const no = [
      "  const total = a + b;", // local binding, not exported, not arrow
      "  return helper();",
      "// export function commented out",
      "  if (ready) {",
      "  this.value = 3;",
      "import { x } from './y';",
      "        foo(bar, baz);",
    ];
    for (const line of no) expect(re.test(line), line).toBe(false);
  });
});

describe("formatRepoMap", () => {
  const hits: SearchMatch[] = [
    { path: "src/a.ts", line: 3, text: "export function alpha() {" },
    { path: "src/a.ts", line: 9, text: "class Beta {" },
    { path: "src/b.ts", line: 1, text: "export const gamma = () => {" },
  ];

  it("groups symbols by file with line numbers", () => {
    const out = formatRepoMap(hits);
    expect(out).toContain("src/a.ts");
    expect(out).toContain("  3: export function alpha()");
    expect(out).toContain("  9: class Beta");
    expect(out).toContain("src/b.ts");
    expect(out).toContain("  1: export const gamma = () =>");
  });

  it("cleans trailing braces and collapses whitespace", () => {
    const out = formatRepoMap([{ path: "f.ts", line: 1, text: "export   function   x()   {" }]);
    expect(out).toContain("1: export function x()");
    expect(out).not.toContain("{");
  });

  it("caps symbols per file", () => {
    const many: SearchMatch[] = Array.from({ length: 60 }, (_, i) => ({
      path: "big.ts",
      line: i + 1,
      text: `function f${i}() {`,
    }));
    const out = formatRepoMap(many, 100000, 40);
    expect(out.match(/function f\d+/g)!.length).toBe(40);
  });

  it("respects the char budget and notes omitted files", () => {
    const files: SearchMatch[] = Array.from({ length: 50 }, (_, i) => ({
      path: `file${i}.ts`,
      line: 1,
      text: `export function fn${i}() {`,
    }));
    const out = formatRepoMap(files, 300);
    expect(out).toContain("ファイルは省略");
    expect(out.length).toBeLessThan(500);
  });

  it("returns empty string for no matches", () => {
    expect(formatRepoMap([])).toBe("");
  });

  it("excludes non-code files (markdown code fences must not pollute the map)", () => {
    const out = formatRepoMap([
      { path: "specs/design.md", line: 10, text: "export function example() {" },
      { path: "README.md", line: 5, text: "class Sample {" },
      { path: "notes.txt", line: 1, text: "def helper():" },
      { path: "src/real.ts", line: 2, text: "export function real() {" },
      { path: "src-tauri/src/lib.rs", line: 7, text: "pub fn run() {" },
    ]);
    expect(out).not.toContain("design.md");
    expect(out).not.toContain("README.md");
    expect(out).not.toContain("notes.txt");
    expect(out).toContain("src/real.ts");
    expect(out).toContain("src-tauri/src/lib.rs");
  });
});
