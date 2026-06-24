// Difficulty router (gateway): a single cheap call classifies a request so the
// app applies only as much machinery as the task needs — trivial answers skip
// the heavy pipeline (faster/cheaper), hard ones get deep reasoning.

import { complete, type ApiMessage } from "./openrouter";

export type Route = "trivial" | "agent" | "deep";

const CLASSIFY: ApiMessage = {
  role: "system",
  content:
    "You are a fast task router for a coding assistant. Classify the user's request into ONE word:\n" +
    "- trivial: a quick question answerable from general knowledge, no file reads/edits or commands\n" +
    "- agent: a normal coding task that needs reading/editing files or running commands\n" +
    "- deep: a hard task needing multi-step investigation, design, or careful verification " +
    "(subtle debugging, architecture/trade-off analysis, large or risky refactors)\n" +
    "Reply with EXACTLY one word: trivial, agent, or deep. No punctuation.",
};

/** Returns the routing decision; defaults to "agent" on any uncertainty/error. */
export async function classifyTask(text: string, model?: string): Promise<Route> {
  try {
    const { content } = await complete([CLASSIFY, { role: "user", content: text }], model);
    const w = content.toLowerCase();
    if (w.includes("trivial")) return "trivial";
    if (w.includes("deep")) return "deep";
    return "agent";
  } catch {
    return "agent";
  }
}
