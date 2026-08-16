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

/** Context handed to `consultAdvisor` at the moment stuck-detection fires.
 * Deliberately thin (log + attempt counters only) — the CALLER's closure is
 * expected to already capture the original user request/task description and
 * fold it into the prompt it sends to the advisor model. Without that, the
 * advisor sees only a bare error with no idea what was being attempted, which
 * produces generic, unhelpful advice (specs/advisor-mode.md §1, advisor
 * design review). */
export interface AdvisorStuckContext {
  log: string;
  attempt: number;
  maxAttempts: number;
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
  /** Optional: when set (advisor auto-consult is ON and an advisor model is
   * configured), stuck-detection consults this once instead of giving up
   * immediately. Returning `null` (e.g. the advisor call itself failed)
   * falls through to the normal stuck report. */
  consultAdvisor?: (context: AdvisorStuckContext) => Promise<string | null>;
  aborted?: () => boolean;
}

type AttemptResult =
  | { kind: "passed"; stdout: string; stderr: string }
  | { kind: "failed"; log: string; sig: string }
  | { kind: "exec-error" };

/** Run one exec cycle (start/end callbacks + signature computation), shared by
 * the main loop and the advisor's one-off bonus round below. */
async function runOneAttempt(command: string, deps: VerifyDeps): Promise<AttemptResult> {
  deps.onCommandStart(command);
  let result: CommandResult;
  try {
    result = await deps.exec(command);
  } catch (e) {
    deps.onCommandEnd(false, `検証コマンド実行エラー: ${e instanceof Error ? e.message : String(e)}`);
    return { kind: "exec-error" };
  }
  const log = `exit code: ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
  if (result.code === 0) {
    deps.onCommandEnd(true, log);
    return { kind: "passed", stdout: result.stdout, stderr: result.stderr };
  }
  deps.onCommandEnd(false, log);
  return { kind: "failed", log, sig: errorSignature(log) };
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
  let advisorConsulted = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (deps.aborted?.()) return "aborted";
    const r = await runOneAttempt(command, deps);
    if (r.kind === "exec-error") return "exec-error";
    if (r.kind === "passed") {
      deps.report(
        `✅ 検証コマンド \`${command}\` が成功しました（試行 ${attempt}/${maxAttempts}）。\n\n` +
          `通過の証拠（出力の末尾）:\n\`\`\`\n${evidenceTail(r.stdout + "\n" + r.stderr)}\n\`\`\``,
      );
      return "passed";
    }

    // Stuck detection: the same normalized failure twice in a row means the
    // model is looping on one idea — stop and hand off instead of burning
    // more attempts on it.
    if (prevSig !== null && r.sig === prevSig) {
      if (deps.consultAdvisor && !advisorConsulted) {
        if (deps.aborted?.()) return "aborted";
        advisorConsulted = true;
        const advice = await deps.consultAdvisor({ log: r.log, attempt, maxAttempts });
        if (advice) {
          deps.report(
            `💡 同じエラーが2回連続で発生したため、上位アドバイザーに相談しました。助言をもとにもう一度だけ試します。`,
          );
          await deps.fix(
            buildFixPrompt(command, r.log) + `\n\n参考: 上位アドバイザーからの助言:\n${advice}`,
          );
          // Bonus round, deliberately OUTSIDE the for-loop's attempt count.
          // Stuck-detection can trip as early as attempt 2 of a 2-attempt
          // budget (it needs two signatures to compare), which would leave
          // zero budget left to verify whether the advice actually helped if
          // this consumed a normal slot. `advisorConsulted` still caps it at
          // exactly one shot for the whole loop, so it cannot be used to
          // bypass the overall attempt limit.
          if (deps.aborted?.()) return "aborted";
          const advised = await runOneAttempt(command, deps);
          if (advised.kind === "exec-error") return "exec-error";
          if (advised.kind === "passed") {
            deps.report(
              `✅ アドバイザーの助言をもとに検証コマンド \`${command}\` が成功しました。\n\n` +
                `通過の証拠（出力の末尾）:\n\`\`\`\n${evidenceTail(advised.stdout + "\n" + advised.stderr)}\n\`\`\``,
            );
            return "passed";
          }
          if (advised.sig === r.sig) {
            deps.report(
              `🛑 アドバイザーの助言後も同じエラーが続いたため、ループを停止しました（思考が固着している可能性）。\n` +
                `**新しいスレッド（別コンテキスト）で修復を依頼する**か、より強いモデルに切り替えて再試行してください。エラーログは上のカードで確認できます。`,
            );
            return "stuck";
          }
          // The advice changed the error — real progress, not a repeat. Fold
          // back into normal bookkeeping and keep going.
          prevSig = advised.sig;
          if (attempt >= maxAttempts) {
            // The advisor's bonus round ran outside the attempt count (see the
            // comment above `runOneAttempt`'s call), so `maxAttempts + 1`
            // attempts actually ran here, not `maxAttempts` — say so.
            deps.report(
              `⚠️ 検証コマンドが ${maxAttempts + 1} 回試しても失敗しました（アドバイザー相談後の1回を含む）。残っている問題は上のエラーログのとおりです。手動で確認してください。`,
            );
            return "exhausted";
          }
          if (deps.aborted?.()) return "aborted";
          await deps.fix(buildFixPrompt(command, advised.log));
          continue;
        }
      }
      deps.report(
        `🛑 同じエラーが2回連続で発生したため、ループを停止しました（思考が固着している可能性）。\n` +
          `**新しいスレッド（別コンテキスト）で修復を依頼する**か、より強いモデルに切り替えて再試行してください。エラーログは上のカードで確認できます。`,
      );
      return "stuck";
    }

    prevSig = r.sig;
    if (attempt >= maxAttempts) {
      deps.report(
        `⚠️ 検証コマンドが ${maxAttempts} 回試しても失敗しました。残っている問題は上のエラーログのとおりです。手動で確認してください。`,
      );
      return "exhausted";
    }
    if (deps.aborted?.()) return "aborted";
    await deps.fix(buildFixPrompt(command, r.log));
  }
  return "exhausted"; // unreachable (loop always returns), kept for type safety
}
