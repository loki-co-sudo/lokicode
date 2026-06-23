# lokicode

OpenRouter 経由で **AI エージェント**を使える、**VS Code 風のデスクトップコードエディタ**です。
単なるチャットではなく、AI が**ツールを使ってファイルの読み書きやシェルコマンド実行を行い、実際に作業を代行**します（コード生成・編集・実行など）。

**技術スタック:** Tauri v2 + React + TypeScript + Vite + Monaco Editor + Tailwind CSS

## 主な機能

### AI エージェント
ファイル読み書き・コマンド実行・コードベース横断検索（grep）などのツールを使い、依頼を実際の作業として代行します。

- `write_file` / `run_command` は実行前に承認（差分プレビュー付き、「自動承認」トグルあり）
- マルチステップ作業は **TODO 計画**として可視化、回答は**ストリーミング表示**
- 全 OpenRouter モデルから選択可能（検索＋ Claude / GPT / Gemini などの**プロバイダ絞り込み**）／トークン・コスト使用量を表示

### ディープ推論（再帰深度ループ）
OpenMythos 着想の推論時計算強化。単発の API 呼び出しではなく **ドラフト → 内省（自己検証）×N → 最終合成**を反復します（[仕様](specs/architecture.md)）。

- 思考深度スライダー (1–16)／思考は軽量・合成は高性能の**コスト効率ルーティング**
- 推論中にツールを使って事実ベースで自己検証、収束したら**早期終了**
- **self-consistency**: 独立したドラフトを並列生成し、投票・統合して精度を上げる（サンプル数 1–5）
- **送信前のコスト概算**: 思考/合成モデル・思考深度・サンプル数・ツール使用から OpenRouter 料金の目安を思考深度の近くに表示。
  日本語(CJK)対応のトークン見積もりに加え、**実使用量から自動補正**（出力サイズ・ツール呼び出し回数を学習）して精度を上げます

### エディタの操作性
- **コマンドパレット**（Ctrl+Shift+P）と**クイックオープン**（Ctrl+P でファイル名検索）
- **ワークスペース横断の検索 / 置換**（正規表現・一括置換）
- **統合ターミナル**（Ctrl+J）— ワークスペースで永続シェルを実行し出力をストリーミング表示
- **パネルのトグル**: Ctrl+B サイドバー / Ctrl+Alt+B AI エージェント / Ctrl+J ターミナル。タブは**ホイールクリックで閉じる**
- **ライト / ダークのテーマ切替**、**最近開いたフォルダ**の復元

### Git / GitHub
- 変更一覧・ステージ・コミット、**差分表示**、**ブランチ切替 / 作成**、**pull / push**（ahead/behind 付き）
- **コミット履歴のグラフ表示**（分岐・マージのレーン描画）
- **GitHub ログイン**（OAuth Device Flow）で push / pull をトークン認証

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
> 基本はそちらから選んでください。ディープ推論のおすすめ: 思考=`anthropic/claude-haiku-4.5`（安価）、
> 合成=`anthropic/claude-opus-4.8`（高性能）。

キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`** です。

## プロジェクト構成

```
src/
  App.tsx                 # レイアウト・タブ状態・Ctrl+S・選択をAIへ・設定モーダル
  components/
    ActivityBar.tsx       # 左端のアクティビティバー（エクスプローラ/検索/Git 切替）
    ExplorerPane.tsx      # フォルダツリー
    SearchPane.tsx        # ワークスペース横断の検索 / 一括置換
    TerminalPanel.tsx     # 統合ターミナル（Ctrl+J・出力ストリーミング）
    CommandPalette.tsx    # コマンドパレット（Ctrl+Shift+P）/ クイックオープン（Ctrl+P）
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
    search.ts             # grep / list_files / replace_in_files のラッパ
    terminal.ts           # ターミナルの開始 / 入力 / 出力購読のラッパ
    recent.ts             # 最近開いたフォルダ/ファイルの記録
    github.ts             # GitHub ログイン（device flow）コマンドのラッパ
    updater.ts            # 更新チェック / ダウンロード / 再起動のラッパ
    chatStorage.ts        # 会話の localStorage 永続化
    useModels.ts          # モデル一覧取得フック
src-tauri/
  src/
    lib.rs                # プラグイン登録・ファイル IO / list_dir / run_command コマンド
    search.rs             # grep_search / list_files / replace_in_files
    terminal.rs           # 統合ターミナル（永続シェル・出力ストリーミング）
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

実装済みの機能は「主な機能」を参照。以下は今後の候補（優先度順ではない）。

### エディタ / 操作性
- [ ] **エクスプローラの Git 色分け**（変更=オレンジ / 新規=緑のバッジ）
- [ ] **ターミナルの PTY 化**（色・対話的 TUI 対応、複数タブ）
- [ ] **アウトライン / シンボル一覧**（関数・クラスへジャンプ）
- [ ] **エディタ分割表示**（左右・上下）とタブのドラッグ並べ替え / ピン留め
- [ ] **自動保存**（任意・遅延書き込み）
- [ ] **キーバインドのカスタマイズ**
- [ ] ファイルの**ドラッグ＆ドロップ**で開く

### AI / エージェント
- [ ] チャットの **@メンション**でファイル / シンボルを文脈添付
- [ ] 選択範囲の**クイックアクション**（説明 / リファクタ / テスト生成）
- [ ] **会話スレッドの複数管理**（名前付け・切替・検索）
- [ ] **プロジェクト指示ファイル**（例: `.lokicode/rules`）の自動読み込み
- [ ] エージェント編集の**チェックポイントと一括 Undo**
- [ ] **ローカル LLM（Ollama 等）/ 追加プロバイダ**対応
- [ ] **トークン / コスト上限**の設定とアラート

### Git / 連携
- [ ] **hunk・行単位のステージング**、`blame` 表示
- [ ] **GitHub の PR 作成 / Issue 連携**

### その他
- [ ] UI の**多言語対応（i18n）**
- [ ] **複数ルートのワークスペース**
