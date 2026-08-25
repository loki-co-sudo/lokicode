# グローバル指示ファイル（`~/.lokicode/rules`）— 設計仕様

対象バージョン: 1.12.0 以降
関連: [architecture.md](architecture.md)

## 1. 動機

`.lokicode/rules`(.md) は既存の仕組みで、開いているワークスペードの直下に置くと
その内容がシステムプロンプトに追記される（Claude Code の**プロジェクトローカル**な
`CLAUDE.md` に相当）。しかし、ユーザーが「どのプロジェクトを開いても常に効かせたい
指示」（口調・応答スタイル・共通の作業ルールなど）を持ちたい場合、これまでは
プロジェクトごとに同じファイルをコピーする以外に方法がなかった。

Claude Code の `~/.claude/CLAUDE.md`（ホームディレクトリ配下のグローバル設定、
全プロジェクト共通）に相当する仕組みを追加し、グローバル指示とプロジェクト固有の
指示を併用できるようにする。

## 2. 設計

### 読み込み元

```
<ホームディレクトリ>/.lokicode/rules
<ホームディレクトリ>/.lokicode/rules.md
```

上から順に存在するものを1つだけ読む（既存のプロジェクト側 `.lokicode/rules(.md)` と
同じ探索パターン）。ホームディレクトリは Tauri の `@tauri-apps/api/path` の
`homeDir()` で取得する。読み込みはアプリ起動時（コンポーネントマウント時）に一度だけ
行い、`workspaceRoot` の変更（プロジェクト切り替え）では再取得しない。

### システムプロンプトへの合成順序

`src/lib/systemPrompt.ts` の `buildSystemPrompt` に `globalRules` 引数を追加。
システムプロンプトの末尾に、**グローバル→プロジェクトの順**で別ラベルのブロックとして
追記する:

```
Global instructions (from ~/.lokicode/rules, apply across all projects) — follow these:
<globalRules の中身>

Project-specific instructions (from .lokicode/rules) — follow these in addition to
the global instructions above, and prefer these where the two conflict:
<rules の中身>
```

両方が空なら何も追記しない。片方だけならそのブロックのみ追記する（"in addition to"
の一文は両方存在するときだけ出る）。プロジェクト側が後に来て「衝突時はこちらを優先」と
明示するのは、プロジェクト固有の制約（言語・フレームワークのルールなど）が
汎用的なグローバル指示より具体的で優先度が高いことが多いため。

### 両パイプラインへの配線

Agent モード・ディープシンク（`runRecurrentReasoning`）はどちらも、呼び出し元
（`ChatPane.tsx`）が組み立てた同一の `base: ApiMessage[]` を受け取り、その先頭に
`buildSystemPrompt` の結果が入っている。そのため `buildSystemPrompt` 側に
配線するだけで、Agent・ディープシンクの両方に自動的に伝わる（`reasoning.ts` 側の
変更は不要）。

### テスト容易性のためのリファクタ

`buildSystemPrompt` は元々 `ChatPane.tsx` 内のプライベート関数だったが、他の
純ロジックのテスト（`src/lib/*.test.ts`）と同じパターンでテストできるよう
`src/lib/systemPrompt.ts` に切り出した。`vitest.config.ts` は
`environment: "node"` かつ `include: ["src/**/*.test.ts"]`（Tauri/DOM 依存を
テストランナーに持ち込まない設計）のため、Tauri API を多数 import している
`ChatPane.tsx` から直接 export したままではこのテスト方針に合わない。

## 3. エージェントによるグローバル指示ファイルの編集（1.13.0 で追加）

`write_file` はワークスペード制限（`getRestrictToWorkspace()`、既定 ON）が
有効な間、開いているワークスペード外のパスへの書き込みを拒否する
（`lib/agent.ts` の `workspaceGuard`）。`~/.lokicode/rules.md` は通常
ワークスペード外にあるため、そのままではエージェントが編集できない。

### なぜディレクトリ単位の許可にしなかったか

`~/.lokicode/` には rules ファイルだけでなく、**自動アップデートの署名鍵**
（`updater.key`。README.md の「必要な GitHub Secrets」参照）も置かれる運用が
ある。もしこのディレクトリを丸ごとワークスペード扱いにする（＝プレフィックス
一致で許可する）と、プロンプトインジェクションされたエージェントが
`list_dir` で鍵ファイルの存在に気づき、`read_file` で中身を読み出せてしまう。
これは lokicode 全ユーザーの自動アップデートの署名を偽造できる、という規模の
被害につながる。

### 実装した仕組み: `AgentOptions.extraAllowedPaths`（狭い例外）

- `lib/agent.ts` の `workspaceGuard` に `extraAllowedPaths?: string[]` を追加。
  候補パスを `normAbs`（`withinWorkspace` と同じ正規化：`..` 解決・区切り文字
  統一・大文字小文字の扱いを揃える）した上で**完全一致のときだけ**許可する
  （`isExactlyAllowed`）。プレフィックス一致・ディレクトリ一致は一切行わない。
- 適用されるのは **`read_file` / `write_file` のみ**。`list_dir` /
  `grep_search` / `run_command`（cwd）はこのリストを見ない＝
  `~/.lokicode` を対象にした一覧化・横断検索・作業ディレクトリ指定は
  引き続き全面拒否（`updater.key` の存在自体を見せない）。
- `ChatPane.tsx` がグローバル rules を読み込む際に解決した2つの絶対パス
  （`<home>/.lokicode/rules` と `<home>/.lokicode/rules.md`。ファイルの
  存在有無に関わらず両方）を `globalRulesPaths` として保持し、Agent
  モード・ディープシンク双方の `AgentOptions`/`ReasoningOptions` に
  `extraAllowedPaths` として配線する（`reasoning.ts` の `think()` 内・
  `execOpts` の両方）。
- 通常の承認フロー（`write_file` の承認要求・全自動時の警告等）はこの許可とは
  独立して適用される。ワークスペード制限を通過しても、承認レベルの判定は
  変わらない。

### ユーザー向けの効果

ワークスペード制限を ON にしたままでも、エージェントは
`~/.lokicode/rules(.md)` だけを read/write できる（他のファイルは
`~/.lokicode` 配下も含め従来どおり拒否）。ユーザーが「ワークスペードとして
`~/.lokicode` を開く」操作を意識する必要はなく、開いているプロジェクトの
サイドバー表示も変わらない。

## 4. 既知の制限（今回のスコープ外）

- **トークン見積もりへの反映は 1.13.0 で修正済み**: `ChatPane.tsx` の
  `promptTokens` は以前、システムプロンプトのオーバーヘッドを固定値 `180` の
  みで概算しており、プロジェクト側 `.lokicode/rules` の文字数を含めていなかった
  （今回の変更前からの既存の別バグ）。1.13.0 で `approxTokens(rulesText) +
  approxTokens(globalRulesText)` を加算するよう修正し、依存配列にも追加した。
  固定値 `180`（実際の指示ブロック本文の概算との差分）自体の再較正は別タスク
  のまま。

## 5. 検証

- `npm test`:
  - `src/lib/systemPrompt.test.ts` — グローバルのみ／プロジェクトのみ／
    両方／両方空／空白のみ、の5パターンでブロックの有無・順序・文言を確認。
  - `src/lib/agent.test.ts` の `workspaceGuard extraAllowedPaths` — 許可パスの
    read/write 許可、同ディレクトリの別ファイル（`updater.key` 相当）への
    read/write 拒否、`list_dir`/`grep_search`/`run_command` への不適用、
    `extraAllowedPaths` 省略時に許可されないこと、`rules.md/../updater.key`
    のようなパス走査が単純結合では素通りしないこと、をそれぞれ確認。
  - 全件合格（`npm test` 実行時点で 287 件全合格）。
- `npm run build`: 型チェック（`tsc`）・本体ビルドともに合格。
- **ロジックレベルで確認済み**: `homeDir()` の戻り値と `joinPath` の組み合わせが
  実機の `$HOME`（`/home/loki`）から `/home/loki/.lokicode/rules.md` を正しく
  導出し、実際に置いたファイルを発見できることを Node 上で確認。
- **未実施**: 実機（`npm run tauri dev`）での GUI 目視確認 — 実際にアプリを
  起動し、チャット送信時のシステムプロンプトへの反映、および
  エージェントに `~/.lokicode/rules.md` を編集させる動作の確認。
  この変更のセッションはヘッドレス環境のため未実施。
