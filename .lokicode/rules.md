# lokicode 開発ルール（この repo を編集する AI エージェントへ）

## まず読む
- AI 機能（agent.ts / reasoning.ts / router.ts / cost.ts / agentSettings.ts）を変更する前に、
  CLAUDE.md の「開発ガイド」と specs/README.md（仕様の索引）から該当仕様を read_file で
  読むこと。次に実装すべき改善は specs/frontier-roadmap.md にある。推測で書かない。

## 効率の5原則（AI 機能の変更はこれに沿う）
1. 反復・サンプリング処理には必ず「停止条件」と「易しい課題でのスキップ条件」を付ける。
2. 量の仕事は thinking（安価）モデル、要所（ブリーフ/採点/最終）は synthesis（強）モデル。
   検証器 JUDGE は強モデルから下げない。
3. 事実を主張する前に実ファイルを読む。証拠ゼロで生成する経路を作らない。
4. 品質判定は自己申告でなく、独立の検証器かビルド/テストの exit code で行う。
5. 独立な API 呼び出しは Promise.all で並列化。並列幅は 2 まで（3 以上は品質エフォート限定）。

## ループ開発（コーディングタスクの進め方）
- 変更→検証（npm test / npm run build）→失敗ならログを読んで修正→再検証、を通るまで回す。
- 「完了」と報告できるのは全チェック通過時のみ。通過した出力の末尾を証拠として添える。
- ループは最大5回。同じエラーが2回連続したら止めて、状況を報告し新しい会話での修復を提案する。
- テスト/アサーションの削除・弱体化・スキップで通そうとしない。直すのはコード本体。

## 変更時の必須手順
- API 呼び出し回数が変わる変更は src/lib/cost.ts の pipelineShape を同じ分岐で更新する。
- 調整可能な値は定数に焼き込まず src/lib/agentSettings.ts の getter（localStorage lokicode.*）
  経由にする。エフォート（速度/バランス/品質）は EFFORT_PARAMS に連動させる。
- テスト: npm test。型/ビルド: npm run build。両方通ってから完了とする。
- 機能・挙動を変えたら同じコミットで README.md（日本語）も更新する。
- コミットは English prefix（feat:/fix:/docs: 等）+ 日本語説明。

## 禁止事項
- 旧 v1 線形ループ・自己申告の収束判定（CONVERGED 等）の再導入。
- アンサンブルドラフトを証拠なしで実行（最小接地を外さない）。
- openrouter/fusion・auto・pareto-code を thinking/synthesis に設定・推奨。
- reset --hard / push --force / clean -f 等の破壊的 git（明示依頼がない限り）。
