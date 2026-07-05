// Shared execution-grounded verify loop (Reflexion): run a verify command,
// on failure hand the log to a fix round, repeat until green / attempts run
// out / the same error repeats (stuck). Used by BOTH the plain Agent mode
// (ChatPane) and deep-think's execute phase (frontier-roadmap P1) so the two
// paths cannot drift apart. Pure control flow — all side effects are injected,
// which is what makes it unit-testable without a machine or an API.

import { errorSignature, evidenceTail } from "./loop";

export type VerifyOutcome = "passed" | "stuck" | "exhausted" | "exec-error" | "aborted";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface VerifyDeps {
  /** Execute the verify command (non-interactive) and return its output. */
  exec: (command: string) => Promise<CommandResult>;
  /** One fix round: send the ready-made failure prompt to a tool-using agent. */
  fix: (fixPrompt: string) => Promise<void>;
  /** A verify attempt is starting (render a running command card). */
  onCommandStart: (command: string) => void;
  /** The attempt finished; `ok` is exit-code-0, `log` is the full output. */
  onCommandEnd: (ok: boolean, log: string) => void;
  /** Post a user-facing report message (✅ evidence / 🛑 stuck / ⚠️ exhausted). */
  report: (markdown: string) => void;
  aborted?: () => boolean;
}

/** Failure log embedded in the fix request, with the no-test-weakening rule. */
export function buildFixPrompt(command: string, log: string): string {
  const clipped = log.length > 6000 ? log.slice(0, 3000) + "\n…(中略)…\n" + log.slice(-3000) : log;
  return (
    `検証コマンド \`${command}\` が失敗しました。出力:\n\n${clipped}\n\n` +
    `このエラーの原因を特定し、ファイルを修正して直してください。` +
    `テストやアサーションを削除・弱体化・スキップして通そうとしないこと（直すのはコード本体であり、評価基準ではありません）。`
  );
}

/**
 * Run the change→verify→fix loop. Loop-mode semantics (specs/loop-mode.md):
 * evidence-quoted success report, stop on the same normalized error twice in a
 * row, bounded attempts, honest failure reports.
 */
export async function runVerifyLoop(
  command: string,
  maxAttempts: number,
  deps: VerifyDeps,
): Promise<VerifyOutcome> {
  let prevSig: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (deps.aborted?.()) return "aborted";
    deps.onCommandStart(command);
    let result: CommandResult;
    try {
      result = await deps.exec(command);
    } catch (e) {
      deps.onCommandEnd(
        false,
        `検証コマンド実行エラー: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "exec-error";
    }
    const log = `exit code: ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
    if (result.code === 0) {
      deps.onCommandEnd(true, log);
      deps.report(
        `✅ 検証コマンド \`${command}\` が成功しました（試行 ${attempt}/${maxAttempts}）。\n\n` +
          `通過の証拠（出力の末尾）:\n\`\`\`\n${evidenceTail(result.stdout + "\n" + result.stderr)}\n\`\`\``,
      );
      return "passed";
    }
    deps.onCommandEnd(false, log);
    // Stuck detection: the same normalized failure twice in a row means the
    // model is looping on one idea — stop and hand off instead of burning
    // more attempts on it.
    const sig = errorSignature(log);
    if (prevSig !== null && sig === prevSig) {
      deps.report(
        `🛑 同じエラーが2回連続で発生したため、ループを停止しました（思考が固着している可能性）。\n` +
          `**新しいスレッド（別コンテキスト）で修復を依頼する**か、より強いモデルに切り替えて再試行してください。エラーログは上のカードで確認できます。`,
      );
      return "stuck";
    }
    prevSig = sig;
    if (attempt >= maxAttempts) {
      deps.report(
        `⚠️ 検証コマンドが ${maxAttempts} 回試しても失敗しました。残っている問題は上のエラーログのとおりです。手動で確認してください。`,
      );
      return "exhausted";
    }
    if (deps.aborted?.()) return "aborted";
    await deps.fix(buildFixPrompt(command, log));
  }
  return "exhausted"; // unreachable (loop always returns), kept for type safety
}
