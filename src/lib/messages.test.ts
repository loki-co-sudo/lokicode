import { describe, it, expect } from "vitest";
import { sanitizeMessages } from "./messages";
import type { ApiMessage } from "./openrouter";

const sys = (content: string): ApiMessage => ({ role: "system", content });
const usr = (content: string): ApiMessage => ({ role: "user", content });
const asst = (content: string | null): ApiMessage => ({ role: "assistant", content });

describe("sanitizeMessages", () => {
  it("drops blank assistant messages (empty content must not reach the API)", () => {
    const input: ApiMessage[] = [sys("system prompt"), usr("question"), asst(""), usr("judge it")];
    const out = sanitizeMessages(input);
    expect(out.length).toBeLessThan(input.length);
    expect(out.some((m) => isBlank(m))).toBe(false);
  });

  it("drops a null-content assistant message with no tool_calls", () => {
    const input: ApiMessage[] = [usr("question"), asst(null), usr("judge it")];
    const out = sanitizeMessages(input);
    expect(out.find((m) => m.role === "assistant")).toBeUndefined();
  });

  it("demotes a system message appearing after the conversation started to user", () => {
    // Preceded by an assistant turn (not user) so rule 4's same-role merge
    // doesn't swallow the converted message, keeping this test isolated to rule 3.
    const input: ApiMessage[] = [
      sys("leading system"),
      usr("question"),
      asst("draft"),
      sys("injected brief"),
    ];
    const out = sanitizeMessages(input);
    // Leading system block stays system.
    expect(out[0].role).toBe("system");
    expect(out[0].content).toBe("leading system");
    // The later system was converted to user, in place, with the context prefix.
    const converted = out.find((m) => m.content && String(m.content).includes("injected brief"));
    expect(converted?.role).toBe("user");
    expect(String(converted?.content).startsWith("【コンテキスト】\n")).toBe(true);
  });

  it("merges consecutive user messages into one", () => {
    const input: ApiMessage[] = [usr("first"), usr("second")];
    const out = sanitizeMessages(input);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toContain("first");
    expect(out[0].content).toContain("second");
  });

  it("does not merge or drop a tool_calls assistant message with null content", () => {
    const toolCallMsg: ApiMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }],
    };
    const input: ApiMessage[] = [usr("question"), toolCallMsg, asst("after")];
    const out = sanitizeMessages(input);
    const kept = out.find((m) => m.tool_calls);
    expect(kept).toBeDefined();
    expect(kept?.content).toBeNull();
    // Not merged with the following assistant message.
    expect(out).toHaveLength(3);
  });

  it("trims trailing whitespace from a trailing assistant message", () => {
    const input: ApiMessage[] = [usr("question"), asst("answer \n")];
    const out = sanitizeMessages(input);
    expect(out[out.length - 1].content).toBe("answer");
  });
});

function isBlank(m: ApiMessage): boolean {
  if (m.tool_calls?.length || m.role === "tool") return false;
  return m.content === null || m.content.trim() === "";
}
