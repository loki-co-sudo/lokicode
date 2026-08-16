# アドバイザーモード — 設計仕様

作成: 1.11.1 時点。deepthink-v3-roadmap.md の P8〜P13 完了後に着手。

**実装状況**（更新中）:
- ✅ §1 経路A（`verifyLoop.ts` の自動相談ロジック）— 実装・テスト（7ケース）・`npm test`/`npm run build` 通過済み。自分の advisor ツールによる設計レビューで3点訂正（§1 内に記録）。
- ✅ §4 コスト整合（`cost.ts` の `PipelineShape.advisorConsult`）— 実装・テスト（6ケース）・`npm test`/`npm run build` 通過済み。`execReview` と同じ非対称ルール（事前概算は発火を仮定しない）を踏襲。`ChatPane.tsx` の `structuralCalls` 呼び出しへの `advisorConsult` 実引数配線は §3（`reasoning.ts`/`ChatPane.tsx` の実行フェーズ配線）とセットで行う——それまでは省略時解釈の `false` のままで安全（advisorConsult 自体がまだどこからも発火しない）。
- ✅ §1 経路B（`consult_advisor` ツール、`agent.ts`）— 実装・テスト（5ケース、`advertisedTools` を純関数として切り出して直接検証）・`npm test`/`npm run build` 通過済み。`AgentOptions.advisorModel` はまだどこからも渡されないため（§2/§3が未着手）、現時点ではツールは常に非advertise＝挙動変化なし。
- ⬜ §2 設定の永続化（`openrouter.rs`/`openrouter.ts`）— 未着手。
- ⬜ §3 スレッド先（`ChatPane.tsx`/`reasoning.ts`）— 未着手。

## 0. 動機

「比較的安いモデルを、フラッグシップ級の品質で使いたい」という目的に対し、現行の再サンプル型アプローチ（`lib/reasoning.ts` の検証×改善ループ・アンサンブル・best-of-N）には構造的な天井がある。`lib/modelGate.ts:44-52` の `estimateEffectiveLevel` が明記する前提:

> テスト時計算の研究知見（**再サンプル型の計算増は約1ティア（指数+10前後）で飽和**、思考モデルが弱いと**半減**）

つまり検証・改善ループは「元のモデルより1段階賢く見せる」のが上限で、それ以上は伸びない。これに対し Claude Code の advisor 機能（`claude-api` スキル参照：安いexecutorモデルが実際の作業をし、要所だけ賢いadvisorモデルに戦略的な助言を求める）は、**judgeのように毎ラウンド強モデルを固定で挟む**のではなく、**詰まった時・要所だけ**相談する疎な構造なので、コスト当たりの効果が出やすい可能性がある。

**位置づけ（重要）**: advisorは既存の検証機構（JUDGE・実行検証P1/P10）の**代替ではない**。CLAUDE.md「検証の分離：自己申告を信用しない」の原則により、合否判定の権限は引き続き JUDGE（LLM-as-judge）か実行結果（exit code）だけが持つ。advisorはあくまで「詰まった時に助言をもらう／ユーザーが明示的に求めたときに意見を聞く」**補助**であり、合否を決めない。

## 1. 発火経路（2つ、ユーザー要望どおり）

### 経路A: 自動発火（設定でON時のみ・詰まり検出時）

**統合先**: `src/lib/verifyLoop.ts:76-86`。現状:

```ts
const sig = errorSignature(log);
if (prevSig !== null && sig === prevSig) {
  deps.report(`🛑 同じエラーが2回連続で発生したため、ループを停止しました...`);
  return "stuck";
}
```

この関数は Agent モードの検証ループと、ディープシンクの実行フェーズ検証（frontier P1、`reasoning.ts` の `verify-exec` ブロック）の**両方から共有利用**されている（`verifyLoop.ts:1-6` のコメントに明記）ため、ここを1箇所直すだけで両方のパスに効く。

**実装済み**（`src/lib/verifyLoop.ts`、`verifyLoop.test.ts` に7ケース追加、`npm test`/`npm run build` 通過）。設計時のドラフトに対し、自分の advisor ツールでレビューを受けて3点訂正した:

1. **`prevSig` 更新漏れ**: ドラフトの `continue` はそのラウンドの `prevSig` 更新をスキップしてしまい、次ループの比較が古い signature とずれるバグがあった。→ advisor ボーナスラウンドの結果を明示的に `prevSig` へ反映してから通常ループへ戻すよう修正。
2. **予算消費のタイミング**: ドラフトは「advisor 相談ぶんの追加 fix は通常予算内で消費」としていたが、stuck 検出は signature 比較に2回分の実行が要るため**最短でも `attempt === 2`** で発火しうる。`maxAttempts=2`（非ループモードの既定）でこれが起きると、advisor 相談後の検証を行う残り予算がゼロになり、助言が効いたかどうか一度も確認せずに `for` ループが終了してしまう（`exhausted` に落ちる隠れバグ）。→ **advisor のボーナスラウンドは `for` ループの `attempt` カウントの外側で1回だけ実行**する設計に変更。`advisorConsulted` フラグでループ全体を通して厳密に1回だけに制限されるため、全体の上限を回避する経路にはならない。
3. **助言の文脈不足**: `consultAdvisor` に渡すのがログだけだと、advisor はタスクの目的や既に試したことを知らずに一般論しか返せない。→ `AdvisorStuckContext { log, attempt, maxAttempts }` を渡す薄いインターフェースは維持しつつ、**呼び出し元のクロージャが元のユーザー依頼をすでに把握している前提**とし、advisor へのプロンプト組み立て時に必ずそれを含めることをコメントで明記（`verifyLoop.ts` は汎用の純ロジックのままとし、タスク文脈は呼び出し側の責務とする）。

```ts
// 実装（src/lib/verifyLoop.ts より抜粋。runOneAttempt は exec+onCommandStart/End+
// signature計算を共通化した内部ヘルパー）
if (prevSig !== null && r.sig === prevSig) {
  if (deps.consultAdvisor && !advisorConsulted) {
    advisorConsulted = true;
    const advice = await deps.consultAdvisor({ log: r.log, attempt, maxAttempts });
    if (advice) {
      await deps.fix(buildFixPrompt(command, r.log) + `\n\n参考: 上位アドバイザーからの助言:\n${advice}`);
      // ボーナスラウンド: for ループの attempt を消費しない（理由は上記2点目）。
      const advised = await runOneAttempt(command, deps);
      if (advised.kind === "passed") { /* ✅ report; return "passed" */ }
      if (advised.sig === r.sig) { /* 🛑 advisor後も同じエラり; return "stuck" */ }
      prevSig = advised.sig; // 進展あり。以降は通常ループへ戻す
      if (attempt >= maxAttempts) { /* ⚠️ exhausted */ }
      await deps.fix(buildFixPrompt(command, advised.log));
      continue;
    }
  }
  deps.report(`🛑 ...`);
  return "stuck";
}
```

`maxAttempts` の意味そのものは変えない（通常の fix→verify サイクルは引き続きこの予算内）。変わったのは「advisor 相談が発生した時だけ、その1回に限り予算の外で検証させる」点——CLAUDE.md の「打ち切りが効かなくなるリスクを避ける」方針には、`advisorConsulted` による**総回数1回のハードキャップ**で応える（予算無制限化ではなく、"詰まった時の最後の一手"を1回だけ許可する設計）。

### 経路B: 明示発火（ツール呼び出し・ユーザー指示ベース）

**新規ツール** `consult_advisor` を `src/lib/agent.ts` に追加。既存の `ASK_USER_TOOL`（`agent.ts:260-277`）と同じ「条件付き advertise」パターン:

```ts
export const CONSULT_ADVISOR_TOOL = {
  type: "function",
  function: {
    name: "consult_advisor",
    description:
      "Consult a stronger, independent advisor model for a second opinion or strategic guidance. " +
      "Call this ONLY when the user's request explicitly asks for advisor input / a second opinion, " +
      "or when you are genuinely stuck and outside guidance would clearly help. Do not call this " +
      "routinely or for decisions you can make yourself.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "A self-contained question — the advisor sees ONLY this, not your conversation history." },
      },
      required: ["question"],
    },
  },
};
```

`runAgent`（`agent.ts:491`〜）の advertise ロジック（現状 `agent.ts:500-502`）を拡張:

```ts
const advertised = [
  ...baseTools,
  ...(opts.allowAskUser && cb.askUser ? [ASK_USER_TOOL] : []),
  ...(opts.advisorModel ? [CONSULT_ADVISOR_TOOL] : []),
];
```

`allowAskUser` と違い、`consult_advisor` はユーザーの応答を待たない（別モデルへの1回のAPI呼び出しで完結する）ため、**対話的セッションに限定しない**——ディープシンクの実行フェーズ（非対話的）でも、ユーザーの元依頼に「advisorにも相談して」とあれば呼べるようにする。

**ハンドリング**: `execTool` を経由させず、`update_plan`/`ask_user` と同様にループ内で特別扱い（`agent.ts:574-592` 付近と同じ形）。理由: (1) `cb.onUsage` へのコスト計上を素直に書ける、(2) `execTool` は現状LLM呼び出しをしない前提の関数なので、責務を混ぜない。

```ts
if (name === "consult_advisor") {
  const question = String(args.question ?? "").trim();
  cb.onToolStart({ name, args });
  if (!opts.advisorModel || !question) {
    const msg = "アドバイザーが利用できません（モデル未設定または質問が空）。";
    cb.onToolEnd("error", msg);
    conv.push({ role: "tool", tool_call_id: call.id, content: msg });
    continue;
  }
  try {
    const { content, usage } = await complete(
      [sys(ADVISOR_SYSTEM), usr(question)],
      opts.advisorModel,
      opts.cancelId,
    );
    cb.onUsage?.(usage);
    cb.onToolEnd("done", content);
    conv.push({ role: "tool", tool_call_id: call.id, content });
  } catch (e) {
    const msg = `アドバイザー呼び出しエラー: ${e instanceof Error ? e.message : String(e)}`;
    cb.onToolEnd("error", msg);
    conv.push({ role: "tool", tool_call_id: call.id, content: msg });
  }
  continue;
}
```

**渡すコンテキストは `question` 引数のみ**（会話全文は渡さない）。理由: (1) コストを予測可能に保つ（P11「証拠予算」と同じ思想——無制限にコンテキストを流し込まない）、(2) 実行モデル自身に「自己完結した質問」を組み立てさせる方が、advisor側の回答の質も上がりやすい（余計な文脈でノイズが乗らない）。`ADVISOR_SYSTEM` は「あなたは別のAIエージェントから相談を受けている上級アドバイザーです。簡潔かつ具体的に助言してください」程度の短い枠付け。

## 2. 設定（UI・永続化）

思考/合成モデルと同じ経路（`src-tauri/src/openrouter.rs:96-102` の `Settings` 構造体、`src/lib/openrouter.ts:94-156` の `SettingsStatus`/`updateSettings`）に **`advisorModel: string`** を追加する。バックエンド永続化なので Rust 側の構造体・Tauriコマンド・TS側インターフェースの3点セットを揃える必要がある（`thinking_model`/`synthesis_model` のパターンをそのまま踏襲）。

自動相談トグルは、既存の `ensemble`/`loopMode` と同じくローカル `usePersistentBool` で十分（ChatPane.tsx にモデル永続化ほどの重さは不要）:

```ts
const [advisorAuto, setAdvisorAuto] = usePersistentBool("lokicode.advisorAuto", false);
```

デフォルトは **OFF**（CLAUDE.md 原則1「固定の常時発火を足さない」に沿い、明示的にオンにしたユーザーだけがコストを払う）。`consult_advisor` ツール自体は advisorモデルが設定されていれば常時advertiseする（トグルとは独立——経路Bはユーザーの明示指示ベースなので、自動発火トグルとは別ゲート）。

UI: 思考モデル・合成モデルのピッカーの並びに「アドバイザーモデル（賢い・任意）」ピッカーを追加し、その下に「詰まったときに自動で相談する」トグルを置く。

## 3. スレッド先（Agent モード / ディープシンク実行フェーズ）

- `AgentOptions`（`agent.ts:441`〜）に `advisorModel?: string` を追加。
- `ReasoningOptions`（`reasoning.ts:74`〜）に `advisorModel?: string` を追加し、実行フェーズの `execOpts`（`reasoning.ts` 実行パスの `runAgent` 呼び出し）へ渡す。
- `reasoning.ts` の P1 実行検証ブロック（`runVerifyLoop` 呼び出し、`reasoning.ts:772` 付近）の `deps` に `consultAdvisor` を配線（`opts.advisorModel` があるときのみ）。
- ChatPane.tsx の Agent モード呼び出し（非ディープシンク）にも同様に配線——`runVerifyLoop` を直接呼んでいる箇所（Agent モードの検証ループ）に同じ `consultAdvisor` フックを渡す。

分析パイプライン（brief/investigate/judge/final/beam）への統合は**見送り**（§5参照）。**この見送りは `ReasoningOptions.advisorModel` を配線する場所で担保する**——`reasoning.ts` の `think()`（`brief`/`investigate`/`judge`/`final`/beam 各フェーズが共通で使う内部ヘルパー、`reasoning.ts:572`〜）が組み立てる `runAgent` の options オブジェクト（`reasoning.ts:592`〜）には `advisorModel` を**足さない**。`advisorModel` を渡すのは実行フェーズ専用の `execOpts`（`reasoning.ts:776`）だけとする。こうすれば `consult_advisor` は `opts.advisorModel` 条件で自動的に execute フェーズ以外では advertise されず、投資フェーズごとに個別のガードを書く必要がない（advisor design review で指摘: 配線先を1つ間違えると調査サブフェーズが consult_advisor を呼び始め、コストが見えない形で増える）。

## 4. コスト・pipelineShape整合

- **経路A（自動）**: 「詰まった」ときにだけ最大1回発火する data-dependent なレバーで、P6ビームサーチや P10 の `execReview` と同じ扱いにする。`cost.ts` の `PipelineShape` に `advisorConsult: number`（0 or 1）を追加し、`execReview` と同じ非対称ルールを踏襲する: **事前概算（`estimateDeepReasoningCost`）は発火を仮定しない**（詰まるかどうかは実行時にしか分からないので安全側の上限を維持）。**事後校正（`structuralCalls` → `recordToolRun`）だけが実際に発火したかを渡す**。
- **経路B（明示ツール）**: 呼び出し回数はモデルの判断次第で可変。既存の `parallel_query` と同じく、通常のツールループ呼び出し数としてカウント（`toolMult` 較正に自然に乗る）。特別なコストモデリングは不要。

## 5. してはいけないこと・見送り

- **分析パイプライン（brief/judge/final）へのadvisor統合は見送り**——すでに合成モデルが同等の役割（強い視点での判断）を持っており、二重投資になる。今回は Agent 実行ループ（Agent モード＋ディープシンク実行フェーズ）に限定する。
- **advisorに合否判定の権限を与えない**——CLAUDE.md「自己申告のCONVERGEDのような収束判定を導入しない」「検証器を安価モデルに下げない」の精神を、advisorにも適用する。advisorの助言は常に「参考情報」として fix プロンプトに追加されるだけで、advisorが「もう直った」と言っても検証ループはそれを信用せず、必ず実際に検証コマンドを再実行する。
- **advisorへ会話全文を渡さない**——`question` 引数のみ。コスト予測可能性と、P11の「証拠予算」思想を踏襲。
- **経路Aの相談は1ループにつき最大1回**——無限に相談し続けてコストが膨らむのを防ぐ（P6ビームの「1ランに1回だけ」と同じ設計思想）。
- Anthropic 公式の Advisor ツール（`advisor_20260301`）はそのまま流用できない——OpenRouter経由で任意モデルを使う lokicode の設計とは前提が異なる（executor/advisorの組み合わせ制約はAnthropic API専有の概念）。今回は**発想だけを模倣した lokicode 独自実装**とする。

## 6. テスト計画（実装時）

- `verifyLoop.test.ts`: `consultAdvisor` を注入したケースで、(a) stuck検出時に**ちょうど1回**呼ばれること、(b) advisor の助言後にもう1ラウンド `fix` が走ること、(c) **2回目の stuck では呼ばれない**こと（発動回数の上限）をカウントで assert（CLAUDE.md「発動したこと自体をassert」）。
- `agent.test.ts`: `opts.advisorModel` の有無で `CONSULT_ADVISOR_TOOL` が advertise される/されないことを確認。
- `cost.test.ts`: `advisorConsult` フラグの有無で `pipelineShape`/`structuralCalls` が変わることを確認（P10 の `execPath`/`execReview` テストと同じ形）。
- 有料実走（advisorの助言が実際に有用か・詰まりから復帰できるか）は本skillの計測方針どおり**別途ユーザーの実施可否確認を得てから** `e2e/harness` にタスクを追加するか検討する（未計測のまま「効果あり」と主張しない）。

## 7. 実装順（着手時の目安）

1. `verifyLoop.ts`（経路A・純ロジック、最もリスクが低く効果が大きい）
2. `cost.ts`（`advisorConsult` フィールド）
3. `agent.ts`（`CONSULT_ADVISOR_TOOL` + 経路B のハンドリング）
4. `src-tauri`/`openrouter.ts`（設定の永続化）
5. `ChatPane.tsx`（UI・配線）
6. `reasoning.ts`（実行フェーズへの配線）
