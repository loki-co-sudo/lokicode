# lokicode

OpenRouter 経由で **AI エージェント**を使える、**VS Code 風のデスクトップコードエディタ**です。
単なるチャットではなく、AI が**ツールを使ってファイルの読み書きやシェルコマンド実行を行い、実際に作業を代行**します（コード生成・編集・実行など）。

**技術スタック:** Tauri v2 + React + TypeScript + Vite + Monaco Editor + Tailwind CSS

## 主な機能

### AI エージェント
ファイル読み書き・コマンド実行・コードベース横断検索（grep）などのツールを使い、依頼を実際の作業として代行します。

- `write_file` / `run_command` は実行前に承認（差分プレビュー付き、「自動承認」トグルあり）
- マルチステップ作業は **TODO 計画**として可視化、回答は**ストリーミング表示**
- 落ち着いた**チャット UI**（送信メッセージは控えめなチップ、AI 応答はスレッドレール付きで表示）
- 待機中は**「思考インジケータ」**を表示：呼吸するオーブ＋シマー文言（メッセージは巡回）＋**経過時間**で、止まっているのか進行中なのかが一目で分かる（アニメーションは純 CSS で軽量）
- 全 OpenRouter モデルから選択可能（検索＋ Claude / GPT / Gemini などの**プロバイダ絞り込み**、各モデルの**コスト高低・コンテキスト長・ツール対応**、（OpenRouter が公開していれば）**知能/コーディング指数**を表示）／トークン・コスト使用量を表示
- モードは **Agent ⇄ Chat トグル**＋**ディープ推論トグル**（各種設定はトグルスイッチ）
- **プロジェクト指示ファイル** `.lokicode/rules`(.md) を自動でシステムプロンプトに付与
- **逆質問（`ask_user`）**：依頼が曖昧で結果を左右するとき、推測せず**1問だけ確認**してから進む（Agent モード）
- **セルフチェック**：回答前に目的・制約に照らして自己点検し、必要なら自動修正（トグル・既定ON。Agent モード）
- **会話スレッドの複数管理**（名前付け・切替・削除）／**コスト上限アラート**（累計超過で警告）
  - 会話の永続化は**サイズ上限付き**（大きなツール出力は保存時に自動で切り詰め・古い項目を間引き）。localStorage が満杯でもアプリが落ちないよう、保存失敗は無害化。万一表示でエラーが起きても**復旧画面**（再読み込み／会話データ初期化）で回復できる
- チャットの **@メンション**でワークスペースのファイルを文脈添付
- エディタ右クリックの**クイックアクション**（選択範囲を 説明 / リファクタ / テスト生成）
- エージェントの**編集チェックポイント**：このセッションの変更を**ワンクリックで一括 Undo**。AI が書き込むたびに **Git パネル／エクスプローラがリアルタイム更新**され、作業中の差分がその場で見える
- **並列サブタスク**（`parallel_query`）：複数の調査を並行実行してまとめて回収
- **OpenAI 互換の任意エンドポイント対応**（設定の API ベース URL）— Ollama 等の**ローカル LLM**や他プロバイダを利用可能

### ディープ推論（オーケストレータ型 v2）
単発の API 呼び出しではなく、**設計ブリーフ（強モデルが意図・成功基準・調査計画を作成）→ 並列の接地調査（読み取り専用ツール）→ 十分性ゲート（不足なら追加調査）→ 証拠ベースのドラフト → 基準で採点する検証×N（合格で早期終了）→ 高性能モデルで最終合成**を行います（[v2 仕様](specs/deep-reasoning-v2.md) / [基盤設計](specs/architecture.md)）。

- **広さ（調査の広さ 1–5）と深さ（検証の深さ 1–16）を分離**：広さで網羅性、深さで正確性。どちらも **Agent モードで有効**
- 安価な思考モデルが量（調査・検証・ドラフト）を、高性能モデルが要所（計画・最終）を担当する**コスト効率ルーティング**。思考モデルが未設定のときは、無料の **`openrouter/free`（Free Models Router）を既定で使用** — コスト最優先の推奨設定です（モデルは設定画面で選択。未選択時はチャットに注意と誘導を表示）
- **アンサンブル（Mixture-of-Agents）**：難しめの課題では、ドラフトを廉価モデルで**並列複数生成→統合**し、最終回答も**複数候補を生成→強モデルが検証者として最良を選抜**。並列実行なので速度はほぼ据え置きで、廉価モデルでも回答精度を底上げ（簡単な課題は自動で単発）
- 調査は実ファイル・実コマンド結果で**接地**し、`file:line` を引用。検証は穏やかな改善ではなく**欠陥列挙→改善**の敵対的レビュー
- **検証器ガイドの適応的深化（v2.1）**：独立した審査員（LLM-as-judge）がルーブリックで**採点**し、合格で早期終了／低スコアが続けば**強モデルへ自動昇格**（モデルカスケード）。改善・最終は読み取り専用ツールで**事実を再確認**し、無根拠・矛盾・凡庸を除去（自己申告 `CONVERGED` を廃止）
- **意図駆動の設計ブリーフ（v2.2）**：研究前に強モデルが**GOAL（対象読者・成果物）と CRITERIA（このタスク固有の合否基準）**を定義し、全フェーズと検証器の採点基準をそれに固定。これにより「深いが依頼意図から逸脱」を防ぐ。**十分性ゲート**で証拠不足なら追加調査を1回挟む
- **送信前のコスト概算**：上記フローの構造から OpenRouter 料金の目安を表示。日本語(CJK)対応のトークン見積もりに加え、**実使用量から自動補正**（出力サイズ・ツール呼び出し回数を学習）

### エディタの操作性
- **コマンドパレット**（Ctrl+Shift+P）と**クイックオープン**（Ctrl+P でファイル名検索）
- **ワークスペース横断の検索 / 置換**（正規表現・一括置換）
- **統合ターミナル**（Ctrl+J）— PTY ベースの本格ターミナル（xterm.js）。色付き出力・vim 等の対話的 TUI・リサイズ追従、**複数タブ・分割表示**に対応。Windows では **PowerShell**（PSReadLine）を使い、**↑↓の履歴・Ctrl+R 検索・タブ補完**が利用可。**コピー/ペースト**（Ctrl+Shift+C / Ctrl+Shift+V / Ctrl+V / Shift+Insert / 右クリック）と**1万行スクロールバック**に対応
- **アウトライン / シンボル検索**（Ctrl+Shift+O・Monaco ネイティブ）
- **エディタの分割表示**（左右・各グループ独立のタブ／コマンドパレットで切替）
- **パネルのトグル**: Ctrl+B サイドバー / Ctrl+Alt+B AI エージェント / Ctrl+J ターミナル。タブは**ホイールクリックで閉じる**
- **自動保存**（任意・遅延書き込み）／ファイルの**ドラッグ＆ドロップで開く**
- **複数フォルダ（マルチルート）のワークスペース**（エクスプローラに複数ルートを表示）
- タブの**ドラッグ並べ替え**・**ピン留め**（中ボタンで閉じる）／**キーバインドのカスタマイズ**（設定）
- **設定は左アクティビティバーの歯車**から開く（API キー / ベース URL / 各モデル / **エージェントのループ上限・コマンドタイムアウト** / キーバインド / GitHub 連携を一画面で設定）
- 起動時はサンプルファイルを開かず、**全タブを閉じると空状態**（新規ファイル / ファイルを開く / フォルダを開く の導線）を表示
- **エクスプローラの Git 色分け**（変更ファイルをステータス色で表示）
- **ライト / ダークのテーマ切替**、**最近開いたフォルダ**の復元

### Git / GitHub
- 変更一覧・ステージ・コミット、**差分表示**、**ブランチ切替 / 作成**、**pull / push**（ahead/behind 付き）
- **コミット履歴のグラフ表示**（分岐・マージのレーン描画）／ファイルの **blame** 表示／**hunk 単位のステージ / アンステージ**
- **GitHub ログイン**（OAuth Device Flow）で push / pull をトークン認証
- **PR 作成 / Issue 作成**（ソース管理パネルからブラウザで GitHub を開く）

### エディタ
Monaco ベース。フォルダを開いてエクスプローラ表示、複数タブ編集。開いていたフォルダ・パネル状態は再起動後に自動復元、AI パネルは開閉可能。

### 配布
インストール版は起動時に新版を検知し、アプリ内で自己更新（Tauri updater + GitHub Releases）。

## 必要なもの

- **Node.js** 18 以上 と npm
- **Rust** ツールチェーン（Tauri に必須） — <https://rustup.rs> からインストール
- OS 別の前提条件 — <https://tauri.app/start/prerequisites/>
  （Windows の場合: **Microsoft C++ Build Tools**（「C++ によるデスクトップ開発」ワークロード）と **WebView2**。WebView2 は Windows 11 に標準同梱）

## セットアップ

```bash
# 1. 依存関係をインストール
npm install

# 2. API キーを設定（開発時）
cp .env.example .env
# .env を編集して OPENROUTER_API_KEY を設定
```

API キーは <https://openrouter.ai/keys> で取得できます。

> パッケージ版（ダブルクリック起動）では `.env` を読みません。初回起動後、画面右上の
> **⚙️ 設定**からキーを入力してください（OS のアプリ設定フォルダに保存されます）。

## 開発・実行

```bash
# デスクトップアプリとして起動（要 Rust）
npm run tauri dev

# フロントエンドのみブラウザで確認（Rust 不要・UI 確認用。Tauri 機能は動きません）
npm run dev
```

## ビルド（配布用インストーラ）

```bash
npm run tauri build
```

生成物（Windows）:

- インストーラ: `src-tauri/target/release/bundle/nsis/*.exe`（または `msi/*.msi`）
- 単体実行ファイル: `src-tauri/target/release/lokicode.exe`

インストーラを実行するとスタートメニュー / デスクトップにアイコン付きショートカットが作成され、
**アイコンをダブルクリックして起動**できるようになります。

## リリースと自動アップデート

インストール版は起動後に新バージョンを検知し、アプリ内で自己更新できます（Tauri updater + GitHub Releases）。

### アプリ内の挙動

- **起動時に自動で 1 回チェック**（サイレント）。新版があれば画面上部にバナーで案内し、
  「今すぐ更新して再起動」でダウンロード → 適用 → 再起動まで行えます。
- ヘッダ右の「**更新を確認**」ボタンでいつでも手動チェック（最新ならその旨を表示）。

### 配布サーバ

- 置き場所: **GitHub Releases**（`loki-co-sudo/lokicode`）。
- エンドポイント: `https://github.com/loki-co-sudo/lokicode/releases/latest/download/latest.json`
- 更新成果物は minisign 鍵で署名し、アプリに埋め込んだ公開鍵で検証します。

### リリース手順（自動化）

1. `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` の `version` を上げる。
2. `git tag vX.Y.Z && git push origin vX.Y.Z`（`v*` タグ）を push。
3. GitHub Actions（`.github/workflows/release.yml`）が Windows でビルド・署名し、
   インストーラ・`.sig`・`latest.json` を添付した Release を公開します。

### 必要な GitHub Secrets（リポジトリ設定で 1 回だけ登録）

| Secret | 値 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.lokicode/updater.key` の中身（全文） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 鍵生成時に設定したパスワード（無しなら空） |

> 秘密鍵・パスワードはリポジトリ外で大切に保管してください。失うと更新に署名できなくなります。
> updater を含む最初のバージョンだけは手動インストールが必要で、それ以降が自動更新の対象です。

## GitHub ログイン連携（セットアップ）

設定画面の「GitHub アカウント連携」から OAuth Device Flow でログインできます。
ログインすると push / pull がトークン認証で通り、ユーザー情報が表示されます。

利用するには、オーナーが **GitHub OAuth App を 1 つ登録**して Client ID を埋め込む必要があります（1 回だけ）:

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App。
2. **Enable Device Flow** にチェックを入れて作成。
3. 発行された **Client ID** を `src-tauri/src/github.rs` の `GITHUB_CLIENT_ID` に設定。
   - Device Flow はクライアントシークレット不要。Client ID は秘密ではないので埋め込み可。

> トークンは OS のアプリ設定フォルダ（`github.json`）に保存されます（OpenRouter キーと同水準）。
> Client ID 未設定のうちは、ログイン時に未設定である旨が表示されます。

## 環境変数

Rust バックエンドが読み込みます（`VITE_` プレフィックスは不要・フロントには公開されません）。

| 変数                  | 必須 | デフォルト                     | 説明                         |
| --------------------- | ---- | ------------------------------ | ---------------------------- |
| `OPENROUTER_API_KEY`  | ○    | —                              | OpenRouter の API キー       |
| `OPENROUTER_MODEL`    | —    | `anthropic/claude-sonnet-4.6`  | 使用するモデル ID            |

> モデル ID は OpenRouter 側で随時更新されます。アプリ内のモデル選択は一覧を自動取得するため、
> 基本はそちらから選んでください。ディープ推論のおすすめ: 思考=**`openrouter/free`（無料・既定／コスト推奨）**、
> 合成=高性能モデル（例 `anthropic/claude-opus-4.8` や `deepseek/deepseek-v4-pro`）。

キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`** です。

## プロジェクト構成

```
src/
  App.tsx                 # レイアウト・タブ状態・Ctrl+S・選択をAIへ
  components/
    ActivityBar.tsx       # 左端のアクティビティバー（エクスプローラ/検索/Git/設定 切替）
    ErrorBoundary.tsx     # 表示エラーを捕捉する復旧画面（白画面化を防止）
    ExplorerPane.tsx      # フォルダツリー
    SearchPane.tsx        # ワークスペース横断の検索 / 一括置換
    TerminalPanel.tsx     # 統合ターミナル（Ctrl+J・出力ストリーミング）
    CommandPalette.tsx    # コマンドパレット（Ctrl+Shift+P）/ クイックオープン（Ctrl+P）
    SourceControlPane.tsx # Git ソース管理（status/stage/commit/branch/pull/push/log + アバター）
    GitDiffView.tsx       # ファイルの unified diff を色付き表示
    BlameView.tsx         # git blame（行ごとの作者/コミット）表示
    CommitGraph.tsx       # コミット履歴のグラフ（レーン/ノード）描画
    GithubAccount.tsx     # GitHub Device Flow ログイン UI（設定画面に表示）
    UpdateBanner.tsx      # 起動時の更新チェック + 更新案内バナー
    EditorPane.tsx        # タブバー + ツールバー + Monaco エディタ
    ChatPane.tsx          # チャット UI（ストリーミング・履歴永続化・文脈付与）
    Markdown.tsx          # AI 応答の Markdown 描画（ハイライト + コピー）
    ModelPicker.tsx       # 自動更新されるモデル選択コンボボックス
    SettingsPane.tsx      # 設定ペイン（API キー / モデル / キーバインド / GitHub 連携）
  lib/
    openrouter.ts         # バックエンド呼び出し（complete / chat_once / streamChat）・モデル一覧
    reasoning.ts          # 再帰深度ループ（draft→内省×N→合成）＝ディープ推論コア
    agent.ts              # エージェントループ・ツール定義・ツール実行・承認
    files.ts              # ファイル開く/保存・言語判定
    search.ts             # grep / list_files / replace_in_files のラッパ
    terminal.ts           # ターミナルの開始 / 入力 / 出力購読のラッパ
    recent.ts             # 最近開いたフォルダ/ファイルの記録
    github.ts             # GitHub ログイン（device flow）コマンドのラッパ
    updater.ts            # 更新チェック / ダウンロード / 再起動のラッパ
    chatStorage.ts        # 会話スレッド（複数）の localStorage 永続化
    useModels.ts          # モデル一覧取得フック
src-tauri/
  src/
    lib.rs                # プラグイン登録・ファイル IO / list_dir / run_command コマンド
    search.rs             # grep_search / list_files / replace_in_files
    terminal.rs           # 統合ターミナル（PTY・出力ストリーミング・リサイズ）
    git.rs                # Git コマンド（status/stage/commit/diff/branch/pull/push/log）（git CLI ラッパ）
    github.rs             # GitHub OAuth Device Flow・トークン保存・push/pull 認証
    openrouter.rs         # キー解決・complete / chat_once / streaming・モデル一覧・設定
  capabilities/default.json
specs/architecture.md     # アーキテクチャ仕様（実装前に更新するルール）
app-icon.svg / app-icon.png  # アイコン元データ（`npm run tauri icon` で再生成可能）
```

## セキュリティ

- API キーは **Rust プロセス側**で保持し、フロントエンド（webview）には渡しません。
- `.env` は `.gitignore` 済みです。`.env.example` には**実キーを入れない**でください。
- パッケージ版でのキーは OS のアプリ設定フォルダ（`openrouter.json`）に保存されます。
- ⚠️ **エージェントは実際にファイルを書き換え・コマンドを実行できます。** `write_file` /
  `run_command` は既定で**実行前に承認**を求めます。「自動承認」は内容を理解した上で使ってください。

## 拡張予定（ロードマップ）

当初のロードマップ項目はすべて実装済みです（「主な機能」を参照）。新しいアイデアは随時追記します。

- （候補）UI の多言語対応（i18n）— 日本語前提のため優先度は低め
