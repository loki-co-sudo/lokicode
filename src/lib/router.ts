// Difficulty router (gateway): a single cheap call classifies a request so the
// app applies only as much machinery as the task needs — trivial answers skip
// the heavy pipeline (faster/cheaper), hard ones get deep reasoning, and the
// hardest get deep reasoning at raised depth/breadth (specs/router-effort-link.md).

import { complete, type ApiMessage } from "./openrouter";

export type Route = "trivial" | "agent" | "deep" | "deep-hard";

const CLASSIFY: ApiMessage = {
  role: "system",
  content:
    "You are a fast task router for a coding assistant. Classify the user's request into ONE word:\n" +
    "- trivial: a quick question answerable from general knowledge, no file reads/edits or commands\n" +
    "- agent: a normal coding task that needs reading/editing files or running commands\n" +
    "- deep: a hard task needing multi-step investigation, design, or careful verification " +
    "(subtle debugging, trade-off analysis, non-trivial refactors)\n" +
    "- deep-hard: an EXTREMELY hard or risky task: architecture analysis across many files, " +
    "a subtle bug with unknown cause, or a large refactor where mistakes are costly\n" +
    "Reply with EXACTLY one word: trivial, agent, deep, or deep-hard. No punctuation.",
};

/** Parse the classifier's reply into a route. Pure (unit-tested); checks
 * "deep-hard" before "deep" so the substring can't shadow it, and tolerates
 * separator variants a model might emit. */
export function parseRoute(content: string): Route {
  const w = content.toLowerCase();
  if (/deep[-_ ]?hard/.test(w)) return "deep-hard";
  if (w.includes("trivial")) return "trivial";
  if (w.includes("deep")) return "deep";
  return "agent";
}

/** Returns the routing decision; defaults to "agent" on any uncertainty/error. */
export async function classifyTask(text: string, model?: string): Promise<Route> {
  try {
    const { content } = await complete([CLASSIFY, { role: "user", content: text }], model);
    return parseRoute(content);
  } catch {
    return "agent";
  }
}
