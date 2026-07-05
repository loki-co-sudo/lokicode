# specs/ 索引 — どの仕様を読むべきか

仕様は「**設計時の判断と根拠の記録**」であり、一部の数値・定数はその後のバージョンで
上書きされている。**現在の値は常にコード（`src/lib/agentSettings.ts` の `EFFORT_PARAMS` 等）が
正**。各ファイル冒頭に「現状ノート」がある場合はそれを先に読むこと。

## AI 機能（読む順）

| ファイル | 内容 | 状態 |
| --- | --- | --- |
| [frontier-roadmap.md](frontier-roadmap.md) | **今後の改善計画**（実行検証統合・リポマップ・解分解・証拠キャッシュ…優先順位と実装スケッチ） | 現行・未実装の計画 |
| [deep-reasoning-v2.md](deep-reasoning-v2.md) | ディープシンクの基本構造（ブリーフ→調査→ドラフト→検証→合成）と v1→v2 の経緯 | 構造は現行。**固定定数の記述は旧**（エフォートに置換済み） |
| [agent-v3.md](agent-v3.md) | 難易度ルーター・強い検証器・実行接地の設計 | 現行（ルーターは4分類に拡張済み、検証は最大5回のループモードに発展） |
| [effort-presets.md](effort-presets.md) | 推論エフォート（速度/バランス/品質）と最小接地 | 現行（1.4/1.5 でパラメータ追加あり・表参照） |
| [router-effort-link.md](router-effort-link.md) | ルーター4分類連動・judge多数決・beta卒業の根拠 | 現行 |
| [model-gate.md](model-gate.md) | モデル要件ゲート（必要知能の判定基準） | 現行 |
| [speed-and-level.md](speed-and-level.md) | フェーズ反復バジェット（実測45%短縮）・実効レベル推定式 | 現行 |
| [loop-mode.md](loop-mode.md) | ループモード（変更→検証→修正・証拠つき完了・手詰まり停止） | 現行（ディープ実行フェーズへの適用は frontier-roadmap P1） |

## その他

| ファイル | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | アプリ全体の基盤設計（Tauri/フロント構成） |
| [agent-claude-code.md](agent-claude-code.md) | エージェント設計の参考メモ |
| [git-diff-branch.md](git-diff-branch.md) / [github-login.md](github-login.md) / [updater.md](updater.md) | Git/GitHub/自動更新の各機能仕様 |
