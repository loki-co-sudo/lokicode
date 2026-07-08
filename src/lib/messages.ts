// Normalizes an OpenAI/OpenRouter-style message list before it leaves the
// frontend, so provider-specific quirks (empty content, mid-conversation
// system roles, consecutive same-role turns, trailing whitespace) can't
// trigger a 400 from stricter providers (Anthropic-family in particular).
// See /specs/fix-roadmap-deepthink-400-crossplatform-shell.md 修正1 for the
// full list of 400 sources this guards against.

import type { ApiMessage } from "./openrouter";

const CONTEXT_PREFIX = "【コンテキスト】\n";

function isBlank(content: string | null): boolean {
  return content === null || content.trim() === "";
}

/** Assistant messages carrying tool calls use `content: null` as a real,
 * meaningful placeholder — they must never be dropped or merged like a blank
 * text message. */
function hasToolCalls(m: ApiMessage): boolean {
  return m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
}

export function sanitizeMessages(messages: ApiMessage[]): ApiMessage[] {
  // 1. `content: null` is only meaningful on a tool_calls assistant message;
  // everywhere else it's treated as empty so rule 2 can drop it uniformly.
  let out: ApiMessage[] = messages.map((m) =>
    m.content === null && !hasToolCalls(m) ? { ...m, content: "" } : m,
  );

  // 2. Drop whitespace-only messages (tool_calls assistant and role:"tool"
  // are exempt — their content is a placeholder, not the payload).
  out = out.filter((m) => m.role === "tool" || hasToolCalls(m) || !isBlank(m.content));

  // 3. Only the leading contiguous system block may stay as system; a system
  // message appearing after the conversation has started gets demoted to user
  // IN PLACE (not hoisted to the front — later phases reference it by
  // position, e.g. "the draft above").
  let firstNonSystem = out.findIndex((m) => m.role !== "system");
  if (firstNonSystem === -1) firstNonSystem = out.length;
  out = out.map((m, i) =>
    m.role === "system" && i >= firstNonSystem
      ? { ...m, role: "user" as const, content: CONTEXT_PREFIX + (m.content ?? "") }
      : m,
  );

  // 4. Merge consecutive same-role messages (never merging tool_calls
  // assistant or "tool" messages, which must stay individually addressable).
  const merged: ApiMessage[] = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    const mergeable =
      prev && prev.role === m.role && prev.role !== "tool" && !hasToolCalls(prev) && !hasToolCalls(m);
    if (mergeable) {
      prev.content = `${prev.content ?? ""}\n\n${m.content ?? ""}`;
    } else {
      merged.push({ ...m });
    }
  }

  // 5. A trailing assistant message can't carry trailing whitespace
  // (Anthropic-family providers 400 on it).
  const last = merged[merged.length - 1];
  if (last && last.role === "assistant" && typeof last.content === "string") {
    last.content = last.content.trimEnd();
  }

  return merged;
}
