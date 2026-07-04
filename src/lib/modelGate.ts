// Deep-think model requirements gate: judges whether the selected thinking /
// synthesis models are smart enough for the deep pipeline to actually beat
// single-agent mode. Pure logic (testable). See specs/model-gate.md for the
// threshold rationale ("賢さの壁" ≈ AA intelligence index low-20s; verifier
// needs solid mid-tier or better).

import type { ModelInfo } from "./openrouter";

export type GateLevel = "ok" | "warn" | "critical";

export interface GateIssue {
  level: "warn" | "critical";
  /** Which role the issue is about. */
  target: "thinking" | "synthesis";
  /** What is wrong (short, user-facing, Japanese). */
  reason: string;
  /** What to do about it. */
  advice: string;
}

export interface GateResult {
  level: GateLevel;
  issues: GateIssue[];
}

/** Router/variable meta-model ids: the actual model behind a call is unknown,
 * so intelligence cannot be guaranteed. */
const ROUTER_IDS = new Set([
  "openrouter/free",
  "openrouter/auto",
  "openrouter/fusion",
  "openrouter/pareto-code",
]);

/** Verifier/brief/final below this AA intelligence index cannot reliably catch
 * other models' mistakes — the pipeline's safety net has holes. */
export const SYNTH_MIN_INTELLIGENCE = 35;
/** Recommended verifier level; below this misses become noticeably more likely. */
export const SYNTH_RECOMMENDED_INTELLIGENCE = 45;
/** Below this the investigator/draft quality is poor enough that verification
 * escalations (cost) pile up. */
export const THINKING_MIN_INTELLIGENCE = 25;

const SYNTH_ADVICE =
  "設定で合成モデルを中堅以上（例 google/gemini-2.5-pro、deepseek/deepseek-v4-pro、anthropic/claude-opus 系）にしてください。";
const THINK_ADVICE =
  "設定で思考モデルを安価な固定モデル（例 deepseek/deepseek-chat、google/gemini-2.5-flash）にすると安定します。";

export function assessDeepThinkReadiness(
  thinkingId: string,
  synthesisId: string,
  models: ModelInfo[],
): GateResult {
  const issues: GateIssue[] = [];
  const find = (id: string) => models.find((m) => m.id === id);

  // ── Synthesis: the safety net (verifier / brief / final synthesis) ─────────
  if (synthesisId) {
    if (ROUTER_IDS.has(synthesisId)) {
      issues.push({
        level: "critical",
        target: "synthesis",
        reason: "ルーター/変動系のため実際に使われるモデルが不明で、検証器（安全網）の賢さを保証できません",
        advice: SYNTH_ADVICE,
      });
    } else {
      const m = find(synthesisId);
      if (m) {
        if (m.promptPrice < 0 || m.completionPrice < 0) {
          issues.push({
            level: "critical",
            target: "synthesis",
            reason: "変動価格のメタモデルのため、検証器の賢さもコストも保証できません",
            advice: SYNTH_ADVICE,
          });
        } else {
          if (m.intelligenceIndex != null) {
            if (m.intelligenceIndex < SYNTH_MIN_INTELLIGENCE) {
              issues.push({
                level: "critical",
                target: "synthesis",
                reason: `知能指数 ${Math.round(m.intelligenceIndex)} が最低ライン ${SYNTH_MIN_INTELLIGENCE} 未満で、検証器が他フェーズの誤りを見逃します（Agent 単独より精度が落ちる主因）`,
                advice: SYNTH_ADVICE,
              });
            } else if (m.intelligenceIndex < SYNTH_RECOMMENDED_INTELLIGENCE) {
              issues.push({
                level: "warn",
                target: "synthesis",
                reason: `知能指数 ${Math.round(m.intelligenceIndex)} は推奨ライン ${SYNTH_RECOMMENDED_INTELLIGENCE} 未満で、検証の見逃しが増える可能性があります`,
                advice: SYNTH_ADVICE,
              });
            }
          }
          if (!m.supportsTools) {
            issues.push({
              level: "warn",
              target: "synthesis",
              reason: "ツール非対応のため、最終合成の事実再確認ができません",
              advice: SYNTH_ADVICE,
            });
          }
        }
      }
      // Unknown to the list (custom endpoint etc.): can't judge — stay silent.
    }
  }

  // ── Thinking: investigation / draft / execution ────────────────────────────
  if (thinkingId) {
    if (ROUTER_IDS.has(thinkingId)) {
      issues.push({
        level: "warn",
        target: "thinking",
        reason: "無料/ルーター系のため、調査・実行フェーズの品質とツール対応が引き当て次第で不安定です",
        advice: THINK_ADVICE,
      });
    } else {
      const m = find(thinkingId);
      if (m) {
        if (!m.supportsTools) {
          issues.push({
            level: "critical",
            target: "thinking",
            reason: "ツール非対応のため調査・実行フェーズが接地できず、ディープシンクが Agent 単独より精度が落ちます",
            advice: THINK_ADVICE,
          });
        }
        if (m.intelligenceIndex != null && m.intelligenceIndex < THINKING_MIN_INTELLIGENCE) {
          issues.push({
            level: "warn",
            target: "thinking",
            reason: `知能指数 ${Math.round(m.intelligenceIndex)} が目安 ${THINKING_MIN_INTELLIGENCE} 未満で、調査の質が低く検証での昇格（コスト増）が頻発します`,
            advice: THINK_ADVICE,
          });
        }
      }
    }
  }

  const level: GateLevel = issues.some((i) => i.level === "critical")
    ? "critical"
    : issues.length > 0
      ? "warn"
      : "ok";
  return { level, issues };
}
