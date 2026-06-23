# AI エージェント強化（Claude Code 風）仕様

エージェントを Claude Code のイメージに近づける。3 本柱：
(1) 横断検索 grep ツール、(2) 計画の可視化（TODO）、(3) ストリーミング/詳細な進捗表示。

## 1. 横断検索（grep_search ツール）

- バックエンド `grep_search(root, pattern, maxResults?) -> Vec<SearchMatch>`。
  - `root` 配下を走査（`.git` / `node_modules` / `target` / `dist` / `build` / `.next` は除外）。
  - `regex` クレートでパターン一致行を収集。バイナリ/巨大ファイルはスキップ。
  - `SearchMatch { path（root 相対）, line, text }`。結果は上限（既定 200）でカット。
  - 依存追加: `regex`, `walkdir`。
- エージェントツール `grep_search(pattern, path?)`。`path` 省略時はワークスペースルート。
  - `runAgent` に `workspaceRoot` を渡し、`grep_search` / `run_command` の既定 cwd に使う。

## 2. 計画の可視化（update_plan ツール）

- エージェントツール `update_plan(todos)`。`todos: { content, status }[]`、
  status = `pending` | `in_progress` | `completed`。
- バックエンド操作ではなく、エージェントループが横取りして UI へ反映（`onPlan`）。
  ツール結果には「計画を更新しました」を返す。
- チャットに `AgentItem` の種別 `plan` を追加。最新の計画を 1 枚のチェックリストカードで表示
  （更新のたびに既存カードを置き換え）。
- システムプロンプトに「複数ステップの作業はまず update_plan で計画し、進捗に応じて更新する」を追記。

## 3. ストリーミング / 詳細な進捗表示

- バックレンド `chat_once_stream(messages, tools, model, on_event)`（Channel）。
  - `stream: true` + `tools` でストリーミング。delta.content は逐次 `Delta` で送信、
    delta.tool_calls は index ごとに name/arguments を蓄積。
  - 完了時に組み立てた assistant メッセージ（content + tool_calls）と usage を `Done` で返す。
- フロント `chatOnceStream(...)`：Channel で受け取り、最終メッセージ + usage を解決。
- `runAgent` を streaming 版に変更：各イテレーションのテキストを `onAssistantDelta` で逐次表示、
  `onAssistantDone` でそのバブルを確定。ツール実行中はカードにスピナー表示。

## フロント変更

- `agent.ts`：TOOLS に `grep_search` / `update_plan` を追加、`execTool` 拡張、
  `AgentCallbacks` に `onAssistantDelta` / `onAssistantDone` / `onPlan`、
  `AgentOptions` に `workspaceRoot`。streaming ループ化。
- `openrouter.ts`：`chatOnceStream` と `AgentStreamEvent` 型。
- `ChatPane.tsx`：ストリーミング表示（成長するバブル）、`PlanCard`、grep ツールのラベル/表示、
  実行中スピナー。`runAgent` に `workspaceRoot` を渡す。

## 完了の定義

- grep でコードを検索でき、複数ステップ作業で TODO が更新表示され、回答が逐次ストリーミングされる。
- `README.md`（機能・ロードマップ・構成）を更新（日本語）。
