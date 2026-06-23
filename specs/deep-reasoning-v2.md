# ディープ推論 v2 — オーケストレータ型推論（チャレンジ記録）

> このドキュメントは「ディープ推論の結論がしょぼい」問題を解決するための**実験的な作り直し**の
> 記録です。**もし品質が期待を下回ったり不安定なら、v1（元の仕組み）へ簡単に戻せます**（→ §5）。
> 元のアルゴリズムも本書に丸ごと残してあります。

実装: [`src/lib/reasoning.ts`](../src/lib/reasoning.ts)（v1 / v2 の両方が同居）、
[`src/lib/agent.ts`](../src/lib/agent.ts)（読み取り専用ツールモード）、
[`src/lib/cost.ts`](../src/lib/cost.ts)（概算コスト）。

導入バージョン: **0.21.0**（オーケストレータ初版）→ **0.22.0**（検証器ガイド = v2.1、§8）。基盤の旧設計は [`specs/architecture.md`](architecture.md)。

---

## 1. 問題: なぜ v1 の結論は「しょぼい」のか

v1 は **線形の自己改善チェーン**でした:

```
draft → 「これを批判して改善して」×D → 「まとめて」
```

弱点:

1. **線形の自己批判は盲点を見つけにくい。** 同じモデルが自分の前案を穏やかに磨くだけになりがちで、
   研究的に「自分の答えを正当化」してしまう（外部信号のない self-correction は正確性をあまり上げない、
   という研究結果とも一致）。
2. **純推論モードでは接地（grounding）信号がゼロ。** ツール OFF だと検証はすべて「モデルの想像」。
3. **検証プロンプトが汎用的すぎる**（「誤り・不足を指摘して」）。汎用的な磨きしか出ない。
4. **最終合成が単なる要約**（「簡潔にまとめて」）。高性能モデルを“整形係”に使っており思考に使っていない。
5. **多様性・分解がない。** 研究タスクは本来サブ質問に分解して各々調べ統合すべきだが、課題を丸ごと一本で処理。
6. **self-consistency（並列サンプル）がツール ON 時に無効化**されていた。グラウンディングが効くタスクで多様性を捨てていた。

## 2. v2 の設計: Orchestrator–Worker + 接地済み敵対的深化

```
Plan/分解 ─▶ 並列 Investigation（読み取り専用ツールで接地）
          ─▶ 証拠ベースの Draft
          ─▶ 敵対的・証拠照合の Verify ×D（CONVERGED で早期終了）
          ─▶ 高性能モデルで Final 合成
```

| フェーズ | モデル | ツール | 役割 |
|----------|--------|--------|------|
| **A. Plan/分解** | synthesis（強） | なし | 課題を最大 `breadth` 個の独立サブ質問へ分解（`breadth>1` のときだけ） |
| **B. Investigation** | thinking（安） | 読み取り専用（read/list/grep/parallel_query） | 各サブ質問を**事実で接地**して調査。`file:line` 引用、検証済み事実と仮定を分離 |
| **C. Draft** | synthesis（強） | 読み取り専用 | 収集した「証拠」を最優先に最初の完全な解を作成 |
| **D. Verify ×D** | thinking（安） | フル（承認フローあり） | **懐疑的レビュアー**として欠陥（無根拠な主張・抜け・論理の穴・凡庸さ・代替案）を列挙→改善。完璧なら `CONVERGED` で打ち切り |
| **E. Final** | synthesis（強） | 読み取り専用 | 調査と改善ドラフトを踏まえ、断定的・具体的・誠実な最終回答 |

設計意図:

- **広さ（breadth/`samples`）と深さ（depth）の分離。** 広さ=独立した観点の数、深さ=検証反復回数。
  研究タスクは広さで網羅性、深さで正確性が上がる。**両方ツール ON でも機能する**（v1 は不可だった）。
- **安価モデルが量（調査＋検証）を担当、高性能モデルが要所（計画・ドラフト・最終）だけ**を担当 →
  品質を上げつつコストを抑える（P2 Cost-Efficient Routing を踏襲）。
- **接地（grounding）。** 調査は読み取り専用ツールで実ファイル・実コマンド結果に基づく。検証も事実照合できる。
- **敵対的検証。** 「穏やかな改善」ではなく欠陥列挙を強制し、深さを本当に意味のあるものにする。
- **証拠ブラックボード。** 収集 findings を以降フェーズの system メッセージに載せ、前段の発見を失わない（最大 9000 文字でクリップ）。

### 並列・承認の安全性
- **読み取り専用ツール**（`READ_ONLY_TOOLS` = `write_file`/`run_command` を除いた集合）は承認不要 → 競合なく扱える。
- ツール ON 時の調査は**逐次実行**（ツールカードの順序が乱れないように）。ツール OFF 時は純補完なので**並列**。
- 変更系（write/コマンド）は承認フローのある**逐次の検証/最終フェーズ**でのみ可能。

## 3. リソース制御

- `breadth = clamp(samples, 1..5)`、`depth = clamp(depth, 1..16)`。
- 構造的 API 呼び出し数 ≈ `plan(b>1?1:0) + investigate(b) + draft(1) + verify(D) + final(1)`。
- `breadth=1` のときは分解せず **draft → verify×D → final**（v1 に近いが、プロンプトが大幅に強化され、ツール ON なら draft 自体が接地調査になる）。
- 概算コストは [`cost.ts`](../src/lib/cost.ts) の `estimateDeepReasoningCost` がこの構造で計算（実使用から EWMA 補正）。

## 4. UI

- ChatPane のスライダー: **「検証の深さ」**(= depth) と **「調査の広さ」**(= breadth)。後者は **Agent モードでも有効化**（v1 では無効だった）。
- それ以外の UI・トグル・コールバックは不変。`runRecurrentReasoning` のシグネチャも不変。

---

## 5. ⏪ 復元手順（v1 に戻す）

**いちばん簡単（推奨）:** [`src/lib/reasoning.ts`](../src/lib/reasoning.ts) 冒頭付近の定数を 1 行変えるだけ。

```ts
const USE_ORCHESTRATOR = true;   // ← false にすると v1（元の線形ループ）に戻る
```

`false` にすると `runRecurrentReasoning` が `runLinearRecurrentReasoning`（= 元の実装、本ファイルに丸ごと保存済み）
を呼ぶようになります。他のファイルは変更不要です（シグネチャ互換）。

**任意の追加クリーンアップ**（v1 に完全固定したい場合）:
- ChatPane のスライダー文言を「検証の深さ/調査の広さ」→「思考深度/サンプル数」へ戻し、「調査の広さ」を Agent モードで無効化（`disabled={agentMode}`）。
- `cost.ts` の `estimateDeepReasoningCost` を git で v0.20.0 時点へ戻す。
- `agent.ts` の `readOnly` / `READ_ONLY_TOOLS` は無害なので残してよい。

**git で完全に戻す:** この変更は 0.21.0 の単一コミット。`git revert <commit>` で全体を取り消せます。

## 6. 元アルゴリズム（v1, 参考保存）

```
base = [system, ...history, user(task)]

# Phase 0: ドラフト（thinking）。samples>1 なら独立ドラフトを並列生成し投票・統合（ツール OFF 時のみ）
draft = think(base + nudge("初期解と簡潔な理由"))

# Phase 1..D: 内省 & 改善（thinking）。CONVERGED で早期終了
for k in 1..=D:
    reflect = think(base + [assistant(draft), user("上記を批判的に検証し改善した完全な解を提示")])
    if reflect startsWith CONVERGED: break
    draft = reflect

# Phase Final: 最終合成（synthesis）= 実質「これまでを簡潔にまとめる」
final = think(base + [assistant(draft), user("最終回答を簡潔・正確にまとめる")])
```

呼び出し回数 = `samples(draft) + (samples>1?1:0) + D(reflect) + 1(synthesis)`。
コード本体は `runLinearRecurrentReasoning` として [`src/lib/reasoning.ts`](../src/lib/reasoning.ts) に保存。

## 7. 検証の観点（うまくいったかの判断材料）

- 結論が**具体的か**（`file:line` 引用・根拠つき）、汎用論で終わっていないか。
- 「調査の広さ」を上げたとき**網羅性**が上がるか。
- 「検証の深さ」を上げたとき**実際の誤りが修正**されるか（CONVERGED が早すぎ/遅すぎないか）。
- コスト/レイテンシが許容範囲か（概算コスト表示と実績の乖離）。

期待を下回る場合は §5 で v1 へ即戻し、本書の所見を追記すること。

---

## 8. v2.1 — 検証器ガイドの適応的深化 + 実行接地（0.22.0）

### 動機（実測した失敗）
v2 初版で「このツールを解説して」を投げたところ、**事実誤認**（「ローカルLLM(Ollama)差し替え機構が無い」と回答。実際は base_url で対応済み・設定UIにも欄あり）が混入し、しかも同じ回答内で「openrouter.rs を置き換えれば差し替え可」と**自己矛盾**していた。原因はモデル性能ではなく、**検証フェーズが自己申告(`CONVERGED`)で歯がない**こと＝接地不足。最前線手法の Tier 1（A 実行接地の Reflexion ＋ B 検証器ガイドの適応的深化）で直撃する。

### 変更点（Phase D / E）
- **Phase D を「検証器(LLM-as-judge)→改善」に置換**（[`reasoning.ts`](../src/lib/reasoning.ts)）:
  - 各ラウンドで独立した**採点(JSON: score/defects)**を実施（プレーン補完、ツール無しでクリーンに解析）。ルーブリック: 事実接地・正確性40（無根拠/矛盾は CRITICAL、score を 50 で頭打ち）・深さ/非自明25・網羅20・具体性15。
  - **適応的停止**: `score >= PASS_SCORE(85)` か欠陥ゼロで早期終了（自己申告 `CONVERGED` を廃止）。簡単な課題は早く止まり、難しい課題ほど深く回る。
  - **モデルカスケード**: 中盤以降に `score < ESCALATE_BELOW(70)` なら、その改善ラウンドを**強モデル(synthesis)へ昇格**。難所だけ高コストを払う。
  - **改善(refine)は読み取り専用ツールで接地**（useTools 時、断定前にファイル/ grep で確認）。
- **Phase E を「再検証して仕上げる」接地パスに強化**: 最終合成前に主要主張を証拠＋読み取り専用ツールで**再確認し、無根拠/矛盾/凡庸を除去**。単なる要約をやめる。
- プロンプト全体の**品質バーを引き上げ**（凡庸・未検証を減点、`file:line` を要求）。
- しきい値は `reasoning.ts` 冒頭の `PASS_SCORE` / `ESCALATE_BELOW` で調整可。

### コスト
判定はプレーン補完で短く安価。**早期停止により簡単な課題はむしろ安く**なり、難所だけ深さ＋強モデルを使う。概算は [`cost.ts`](../src/lib/cost.ts) のまま（昇格ぶんは概算が若干低めに出ることがある）。

### v2.1 の復元
- **全体を v1 に戻す**: §5 の `USE_ORCHESTRATOR = false`（不変・最優先の戻し口）。
- **検証器だけ無効化して v2 初版に近づけたい**場合: `PASS_SCORE = 0` にすると毎ラウンド即パスで実質「ドラフト→そのまま最終」に近くなる（暫定）。本格的に戻すなら git で 0.22.0 を revert。
- 旧アルゴリズム本体（v1）は引き続き `runLinearRecurrentReasoning` に保存。
