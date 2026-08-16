import { describe, it, expect } from "vitest";
import { shouldCompact, compactToolResults, COMPACT_THRESHOLD, COMPACT_KEEP_CHARS } from "./agentCompaction";
import type { ApiMessage } from "./openrouter";

function toolMsg(id: string, content: string): ApiMessage {
  return { role: "tool", tool_call_id: id, content };
}
function assistantMsg(content: string | null = null): ApiMessage {
  return { role: "assistant", content };
}

describe("shouldCompact", () => {
  it("is false below the threshold", () => {
    expect(shouldCompact(COMPACT_THRESHOLD - 1)).toBe(false);
  });
  it("is true at and above the threshold", () => {
    expect(shouldCompact(COMPACT_THRESHOLD)).toBe(true);
    expect(shouldCompact(COMPACT_THRESHOLD + 5)).toBe(true);
  });
});

describe("compactToolResults", () => {
  it("does nothing when there are fewer tool messages than keepRecent", () => {
    const conv: ApiMessage[] = [
      assistantMsg(),
      toolMsg("t1", "x".repeat(1000)),
      assistantMsg(),
      toolMsg("t2", "y".repeat(1000)),
    ];
    const r = compactToolResults(conv, 5, 300);
    expect(r.compactedCount).toBe(0);
    expect(r.conv).toEqual(conv);
  });

  it("compacts only tool messages older than the most recent keepRecent (fires — assert the count)", () => {
    const conv: ApiMessage[] = [];
    for (let i = 0; i < 8; i++) {
      conv.push(assistantMsg());
      conv.push(toolMsg(`t${i}`, `result ${i} `.repeat(100))); // long
    }
    const r = compactToolResults(conv, 3, 50);
    // 8 tool messages, keep the most recent 3 verbatim → 5 compacted.
    expect(r.compactedCount).toBe(5);
    const toolMessages = r.conv.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(8);
    // the earliest 5 are shortened; the last 3 are untouched.
    for (let i = 0; i < 5; i++) {
      expect(String(toolMessages[i].content)).toContain("〔圧縮済み〕");
    }
    for (let i = 5; i < 8; i++) {
      expect(String(toolMessages[i].content)).not.toContain("〔圧縮済み〕");
      expect(toolMessages[i].content).toBe(`result ${i} `.repeat(100));
    }
  });

  it("preserves message count, order, roles, and tool_call_id pairing exactly (absolute condition ①)", () => {
    const conv: ApiMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      toolMsg("a", "z".repeat(2000)),
      { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      toolMsg("b", "w".repeat(2000)),
    ];
    const r = compactToolResults(conv, 0, 50); // compact everything eligible
    expect(r.conv).toHaveLength(conv.length);
    for (let i = 0; i < conv.length; i++) {
      expect(r.conv[i].role).toBe(conv[i].role);
      expect(r.conv[i].tool_call_id).toBe(conv[i].tool_call_id);
    }
  });

  it("never rewrites content to an empty string (absolute condition ②)", () => {
    const conv: ApiMessage[] = Array.from({ length: 6 }, (_, i) => toolMsg(`t${i}`, "a".repeat(500)));
    const r = compactToolResults(conv, 1, 10);
    for (const m of r.conv) {
      expect(String(m.content).length).toBeGreaterThan(0);
    }
  });

  it("leaves a short tool message untouched even if it's old", () => {
    const conv: ApiMessage[] = [
      ...Array.from({ length: 5 }, (_, i) => toolMsg(`old${i}`, "x".repeat(500))),
      toolMsg("short", "ok"),
      ...Array.from({ length: 5 }, (_, i) => toolMsg(`recent${i}`, "y".repeat(500))),
    ];
    const r = compactToolResults(conv, 5, COMPACT_KEEP_CHARS);
    const shortMsg = r.conv.find((m) => m.tool_call_id === "short");
    expect(shortMsg?.content).toBe("ok");
  });

  it("is idempotent: compacting an already-compacted conversation again changes nothing further", () => {
    const conv: ApiMessage[] = Array.from({ length: 8 }, (_, i) => toolMsg(`t${i}`, "a".repeat(1000)));
    const first = compactToolResults(conv, 2, 50);
    expect(first.compactedCount).toBeGreaterThan(0);
    const second = compactToolResults(first.conv, 2, 50);
    expect(second.compactedCount).toBe(0);
    expect(second.conv).toEqual(first.conv);
  });

  it("does not touch non-tool messages (assistant/user/system content untouched)", () => {
    const longAssistant = assistantMsg("x".repeat(5000));
    const conv: ApiMessage[] = [
      longAssistant,
      ...Array.from({ length: 8 }, (_, i) => toolMsg(`t${i}`, "a".repeat(1000))),
    ];
    const r = compactToolResults(conv, 2, 50);
    expect(r.conv[0]).toEqual(longAssistant);
  });
});
