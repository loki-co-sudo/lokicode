# lokicode

OpenRouter 経由で **AI エージェント**を使える、**VS Code 風のデスクトップコードエディタ**です。
単なるチャットではなく、AI が**ツールを使ってファイルの読み書きやシェルコマンド実行を行い、実際に作業を代行**します（コード生成・編集・実行など）。

**技術スタック:** Tauri v2 + React + TypeScript + Vite + Monaco Editor + Tailwind CSS

## 主な機能

- 📝 **Monaco エディタ**（VS Code と同じエディタコンポーネント）
- 🧠 **ディープ推論（再帰深度ループ）** — OpenMythos 着想の推論時計算強化。単発の API 呼び出しでなく、
  **ドラフト → 内省（自己検証）×N → 最終合成**を反復して推論を深めます（[仕様](specs/architecture.md)）。
  - **思考深度スライダー (1–16)** で反復回数を制御
  - **コスト効率ルーティング**: 思考は軽量モデル、最終合成は高性能モデル（設定で指定）
  - **脳と手の融合**: 「推論中にツールを使う」をオンにすると、各思考フェーズで
    ファイル読み書き・コマンド実行を行い、**事実に基づいて自己検証**します
  - **収束による早期終了**: 内省で「これ以上改善不要」と判断したら打ち切り、無駄な API 消費を削減
  - 各思考ステップは折りたたみカードで可視化
- 📊 **使用量の可視化** — セッションの**トークン数とコスト**をヘッダー下に表示（クリアでリセット）
- 🤖 **AI エージェント**（ツール使用）— AI が以下のツールを使って実作業を行います:
  - `read_file` / `list_dir` / `grep_search`（読み取り・**コードベース横断検索**・自動実行）
  - `write_file` / `run_command`（**実行前にチャット上で承認/拒否**。「自動承認」トグルあり）
  - `write_file` の承認カードは**差分プレビュー（+追加 / -削除）**で変更内容を確認できます
  - `update_plan` で**マルチステップ作業の計画を TODO リスト表示**（進捗が随時更新される）
  - 回答は**逐次ストリーミング表示**、ツール実行中はスピナーで進捗が分かります
  - ツール呼び出し → 結果を踏まえて次の手、を最終回答まで自動で繰り返します（上限あり）
  - 実行中は**停止ボタン**で中断可能。`run_command` は既定 60 秒で**タイムアウト**（ハング対策）
- 🧭 **アクティビティバー**（左端の VS Code 風タブ）で**エクスプローラ / ソース管理**を切替
- 📁 **エクスプローラ**（フォルダを開いてツリー表示、ファイル種別アイコン付き、クリックでタブに開く）
  - 開いたフォルダは**エージェントの作業ディレクトリ**として文脈に渡され、`run_command` の cwd になります
  - サイドバー（エクスプローラ / ソース管理）は**状態を保持**し、切替時は即表示・裏で自動更新（待ち時間なし）
- 🔀 **ソース管理 (Git)** — 変更ファイルの一覧、**ステージ / アンステージ / コミット**、
  ファイルをクリックで**差分表示**、**ブランチ切替 / 作成**、**pull / push**（ahead/behind 表示付き）、
  **コミット履歴のグラフ表示**（分岐・マージのレーン描画）、リポジトリでなければ `git init`（`git` CLI を使用）
- 🔑 **GitHub ログイン連携**（OAuth Device Flow）— ログインするとユーザー情報を表示し、
  **push / pull がトークン認証**で通る（設定画面からログイン / ログアウト）
- 🗂️ **複数タブ**（新規 / 開く / 閉じる、タブごとの未保存表示、閉じる時に確認）
- 💬 **チャット**（エージェントをオフにすると従来の**ストリーミング応答**チャット）
- ✨ **AI 応答の Markdown 表示**（コードのシンタックスハイライト＋コピー、表など GFM 対応）
- 🤖 **モデル選択**（OpenRouter の**全モデル**から選択）— 検索ボックス＋**プロバイダ絞り込み**
  （Claude / GPT / Gemini など）付きのドロップダウン。一覧は動的取得・⟳ で再取得、ヘッダー / 設定で切替
- 📎 **選択コードを AI へ**（エディタの選択範囲をワンクリックでチャットへ）／**現在のファイルを文脈に含める**トグル
- 💾 **チャット履歴の永続化**（再起動後も復元）＋クリア
- 📂 **ローカルファイルの開く / 保存**（`Ctrl+S` 対応、拡張子から言語を自動判定）
- ↔️ 左右ペインは**ドラッグでリサイズ可能**／入力欄は内容に応じて**自動リサイズ**
- 🪟 **AI エージェントパネルは開閉可能**（ヘッダ右のボタン。左サイドバーと同様にしまえる）
- 🗃️ **開いていたフォルダを再起動後も保持**（前回のワークスペース／サイドバー表示を自動復元）
- 🔧 各種トグル（エージェント/ディープ推論/自動承認など）の状態は**再起動後も保持**。
  AI 応答内のリンクは**外部ブラウザ**で開きます
- 🔐 **API キーは Rust バックエンドで管理**（フロントエンドのバンドルには含まれません）
- ⚙️ アプリ内の**設定画面**から API キー・モデルを変更可能

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
> 基本はそちらから選んでください。ディープ推論のおすすめ: 思考=`anthropic/claude-haiku-4.5`（安価）、
> 合成=`anthropic/claude-opus-4.8`（高性能）。

キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`** です。

## プロジェクト構成

```
src/
  App.tsx                 # レイアウト・タブ状態・Ctrl+S・選択をAIへ・設定モーダル
  components/
    ActivityBar.tsx       # 左端のアクティビティバー（エクスプローラ/Git 切替）
    ExplorerPane.tsx      # フォルダツリー
    SourceControlPane.tsx # Git ソース管理（status/stage/commit/branch/pull/push/log + アバター）
    GitDiffView.tsx       # ファイルの unified diff を色付き表示
    CommitGraph.tsx       # コミット履歴のグラフ（レーン/ノード）描画
    GithubAccount.tsx     # GitHub Device Flow ログイン UI（設定画面に表示）
    UpdateBanner.tsx      # 起動時の更新チェック + 更新案内バナー
    EditorPane.tsx        # タブバー + ツールバー + Monaco エディタ
    ChatPane.tsx          # チャット UI（ストリーミング・履歴永続化・文脈付与）
    Markdown.tsx          # AI 応答の Markdown 描画（ハイライト + コピー）
    ModelPicker.tsx       # 自動更新されるモデル選択コンボボックス
    SettingsModal.tsx     # API キー / モデル設定 / GitHub 連携
  lib/
    openrouter.ts         # バックエンド呼び出し（complete / chat_once / streamChat）・モデル一覧
    reasoning.ts          # 再帰深度ループ（draft→内省×N→合成）＝ディープ推論コア
    agent.ts              # エージェントループ・ツール定義・ツール実行・承認
    files.ts              # ファイル開く/保存・言語判定
    github.ts             # GitHub ログイン（device flow）コマンドのラッパ
    updater.ts            # 更新チェック / ダウンロード / 再起動のラッパ
    chatStorage.ts        # 会話の localStorage 永続化
    useModels.ts          # モデル一覧取得フック
src-tauri/
  src/
    lib.rs                # プラグイン登録・ファイル IO / list_dir / run_command コマンド
    search.rs             # grep_search（ワークスペース横断のコード検索）
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

> 今後追加したい機能のメモ。優先度順ではありません。チェック済みは実装済み。

- [x] **ディープ推論**（再帰深度ループ・コスト効率ルーティング・思考深度 UI）
- [x] **AI エージェント**（ファイル読み書き・コマンド実行のツール使用、承認フロー付き）
- [x] 推論イテレーション中の**ツール使用統合**（脳と手の融合）
- [x] **コードベース横断検索ツール**（grep_search）をエージェントに追加
- [x] **計画の可視化**（update_plan による TODO リスト表示）
- [x] エージェント回答の**ストリーミング表示**と実行中の進捗表示
- [x] 収束ベースの**早期終了**（無駄な反復を削減）
- [x] **トークン/コスト使用量の可視化**（セッション合計）
- [ ] 複数ドラフトの並列生成＋投票（self-consistency）
- [x] **複数タブ**（新規 / 開く / 閉じる、未保存確認）
- [x] AI 応答の **Markdown レンダリング**（コードブロックのシンタックスハイライト・コピー）
- [x] **選択中のコードを AI に送る**（差分適用は未対応）
- [x] **チャット履歴の永続化**（再起動後も復元）
- [x] **モデル切替 UI**（OpenRouter 全モデル・検索＋プロバイダ絞り込み）
- [x] エディタの現在ファイル内容を**コンテキストとして付与**（トグル）
- [x] **エクスプローラ**（フォルダを開いてファイルツリー表示）
- [ ] AI の提案をエディタに**差分適用**
- [x] **アクティビティバー**（エクスプローラ / ソース管理の切替）と **Git ソース管理**
- [x] **Git の差分表示・ブランチ切替/作成・pull/push**・コミット履歴（**グラフ表示**）
- [x] **GitHub ログイン連携**（OAuth Device Flow・push/pull 認証・ユーザー表示）
- [ ] **テーマ切替**（ライト / ダーク、配色プリセット）
- [x] **自動アップデート**（Tauri updater + GitHub Releases・起動時チェック + 更新案内バナー）
- [x] **ワークスペース（開いたフォルダ）の永続化**（再起動後に自動復元）
- [x] **AI エージェントパネルの開閉**（左サイドバーと同様にしまえる）
- [ ] 最近開いたファイル、複数ファイル横断の検索
- [ ] **検索 / 置換**、コマンドパレット
```
