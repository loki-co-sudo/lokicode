# specs/ 索引 — どの仕様を読むべきか

仕様は「**設計時の判断と根拠の記録**」であり、一部の数値・定数はその後のバージョンで
上書きされている。**現在の値は常にコード（`src/lib/agentSettings.ts` の `EFFORT_PARAMS` 等）が
正**。各ファイル冒頭に「現状ノート」がある場合はそれを先に読むこと。

## AI 機能（読む順）

| ファイル | 内容 | 状態 |
| --- | --- | --- |
| [frontier-roadmap.md](frontier-roadmap.md) | **改善計画の正本**（P1〜P6 実装済み・P7 は記録のみ／選択は据え置き） | 現行。実装項目は完了・**残るは P7 自動選択の有効化＝データ待ち** |
| [fix-roadmap-deepthink-400-crossplatform-shell.md](fix-roadmap-deepthink-400-crossplatform-shell.md) | **修正ロードマップ**: ディープシンク 400 解消・Mac/Linux 対応・ターミナルのシェル選択（実装手順書） | **修正1・修正2・修正3すべて実装済み**。修正2の実機（Mac/Linux）動作確認・タグ付きリリースは未実施（CI の3OS通過が根拠） |
| [deep-reasoning-v2.md](deep-reasoning-v2.md) | ディープシンクの基本構造（ブリーフ→調査→ドラフト→検証→合成）と v1→v2 の経緯 | 構造は現行。**固定定数の記述は旧**（エフォートに置換済み） |
| [agent-v3.md](agent-v3.md) | 難易度ルーター・強い検証器・実行接地の設計 | 現行（ルーターは4分類に拡張済み、検証は最大5回のループモードに発展） |
| [effort-presets.md](effort-presets.md) | 推論エフォート（速度/バランス/品質）と最小接地 | 現行（1.4/1.5 でパラメータ追加あり・表参照） |
| [router-effort-link.md](router-effort-link.md) | ルーター4分類連動・judge多数決・beta卒業の根拠 | 現行 |
| [model-gate.md](model-gate.md) | モデル要件ゲート（必要知能の判定基準） | 現行 |
| [speed-and-level.md](speed-and-level.md) | フェーズ反復バジェット（実測45%短縮）・実効レベル推定式 | 現行 |
| [loop-mode.md](loop-mode.md) | ループモード（変更→検証→修正・証拠つき完了・手詰まり停止） | 現行（1.6.0 でディープ実行フェーズにも適用済み。共有実装は `lib/verifyLoop.ts`） |

## その他

| ファイル | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | アプリ全体の基盤設計（Tauri/フロント構成） |
| [agent-claude-code.md](agent-claude-code.md) | エージェント設計の参考メモ |
| [git-diff-branch.md](git-diff-branch.md) / [github-login.md](github-login.md) / [updater.md](updater.md) | Git/GitHub/自動更新の各機能仕様 |
| [terminal-shell-selection.md](terminal-shell-selection.md) | 統合ターミナルのシェル選択（pwsh/powershell/cmd・Unixは/etc/shells検出） |
