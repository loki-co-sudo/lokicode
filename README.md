# lokicode

OpenRouter 経由で **AI エージェント**を使える、**VS Code 風のデスクトップコードエディタ**です。
単なるチャットではなく、AI が**ツールを使ってファイルの読み書きやシェルコマンド実行を行い、実際に作業を代行**します（コード生成・編集・実行など）。

**技術スタック:** Tauri v2 + React + TypeScript + Vite + Monaco Editor + Tailwind CSS

## 目次

- [セットアップ（はじめての方へ）](#セットアップはじめての方へ)
  - [0. 前提環境（必要なもの）](#0-前提環境必要なもの)
  - [A. インストールして使う（最短・推奨）](#a-インストールして使う最短推奨)
  - [B. ソースから動かす（開発者向け）](#b-ソースから動かす開発者向け)
- [最初の一歩（API キー設定とモデル選択）](#最初の一歩api-キー設定とモデル選択)
- [主な機能](#主な機能)
- [開発・ビルド](#開発ビルド)
- [リリースと自動アップデート](#リリースと自動アップデート)
- [GitHub ログイン連携（オーナー設定）](#github-ログイン連携オーナー設定)
- [環境変数](#環境変数)
- [プロジェクト構成](#プロジェクト構成)
- [セキュリティ](#セキュリティ)
- [ロードマップ](#ロードマップ)

---

## セットアップ（はじめての方へ）

目的別に2通りあります。**まず使ってみたいだけなら A**（ビルド不要）、**コードをいじる・自分でビルドするなら B** です。
どちらも先に **0. 前提環境** を済ませてください。

### 0. 前提環境（必要なもの）

| 使い方 | 必要なもの |
| --- | --- |
| **A. インストールして使う** | Windows 10/11。**WebView2**（Windows 11 は標準同梱。Windows 10 は[こちら](https://developer.microsoft.com/microsoft-edge/webview2/)から）。それ以外は不要。 |
| **B. ソースから動かす** | 上記に加えて、**Node.js 18 以上**＋npm、**Rust ツールチェーン**（<https://rustup.rs>）、OS 別の前提（Windows は **Microsoft C++ Build Tools** の「C++ によるデスクトップ開発」ワークロード）。詳細 → <https://tauri.app/start/prerequisites/> |

> どちらの場合も、AI 機能を使うには **OpenRouter の API キー**が必要です（無料枠あり）。取得は <https://openrouter.ai/keys>。設定方法は各手順の中で説明します。

---

### A. インストールして使う（最短・推奨）

1. **インストーラを入手**：[Releases](https://github.com/loki-co-sudo/lokicode/releases/latest) から最新の `*.exe`（NSIS インストーラ）をダウンロード。
2. **インストール**：`.exe` を実行。スタートメニュー／デスクトップにショートカットが作成されます。
3. **起動**：アイコンをダブルクリック。
4. **API キーを設定**：左下の **⚙️（設定）** → 「OpenRouter API キー」に貼り付け → 保存。
   （キーは OS のアプリ設定フォルダに保存され、画面側には出ません。）
5. **（任意）モデルを選ぶ**：設定でモデルを選択（未選択でも動きますが、注意が表示されます）。おすすめは[最初の一歩](#最初の一歩api-キー設定とモデル選択)を参照。

以降は起動するたびにバナーで**自動アップデート**を案内します。

---

### B. ソースから動かす（開発者向け）

```bash
# 1. リポジトリを取得
git clone https://github.com/loki-co-sudo/lokicode.git
cd lokicode

# 2. 依存関係をインストール
npm install

# 3. API キーを設定（開発時は .env を使う）
cp .env.example .env
#   → .env を開き OPENROUTER_API_KEY=sk-or-... を記入

# 4. 起動（デスクトップアプリ。初回は Rust のビルドに数分かかります）
npm run tauri dev
```

- **フロントだけ確認したいとき**（Rust 不要・UI 確認用。Tauri 機能は動きません）：`npm run dev`
- **配布用インストーラを作る**：`npm run tauri build` → [開発・ビルド](#開発ビルド)参照

> パッケージ版（ダブルクリック起動）は `.env` を読みません。A の手順4と同じく、起動後に **⚙️ 設定**からキーを入力してください。
> キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`** です。

---

## 最初の一歩（API キー設定とモデル選択）

1. **API キー**：設定（⚙️）→ OpenRouter API キー。<https://openrouter.ai/keys> で取得。
2. **モデル**：設定でモデルを選びます。一覧は OpenRouter から自動取得され、**コスト分類（無料/低/中/高/変動）・コンテキスト長・ツール対応**などで絞り込めます。
   - **おすすめ（コスパ重視）**：ディープ推論の **思考モデル＝`openrouter/free`（無料・既定）**、**合成モデル＝高性能モデル**（例 `anthropic/claude-opus-4.8` や `deepseek/deepseek-v4-pro`）。
   - 思考モデルは未設定なら自動で `openrouter/free` を使用します。
3. **モードを選ぶ**（チャット入力上のトグル）：
   - **Agent**：AI がツールでファイル読み書き・コマンド実行まで行う（既定）。**Chat** に切り替えると会話のみ。
   - **ディープ推論**：難しい調査・設計向けに多段階で考える（後述）。速度優先なら OFF、または「アンサンブル」OFF・「検証の深さ」を下げる。
4. **OpenAI 互換エンドポイント**（任意）：設定の「API ベース URL」を指定すると Ollama 等のローカル LLM／他プロバイダも使えます。

> ⚠️ エージェントは実際にファイルを書き換え・コマンドを実行できます。`write_file` / `run_command` は既定で**実行前に差分プレビューつきの承認**を求めます。

---

## 主な機能

### AI エージェント
ファイル読み書き・コマンド実行・コードベース横断検索（grep）などのツールを使い、依頼を実際の作業として代行します。

- `write_file` / `run_command` は実行前に承認（差分プレビュー付き、「自動承認」トグルあり）
- マルチステップ作業は **TODO 計画**として可視化、回答は**ストリーミング表示**
- 待機中は**「思考インジケータ」**（呼吸するオーブ＋巡回する文言＋経過時間）で進行中/停止中が一目で分かる
- **逆質問（`ask_user`）**：依頼が曖昧で結果を左右するとき、推測せず**1問だけ確認**してから進む
- **セルフチェック**：回答前に目的・制約に照らして自己点検し、必要なら自動修正（トグル・既定 ON）
- **編集チェックポイント**：このセッションの AI 変更を**ワンクリックで一括 Undo**。書き込むたびに **Git パネル／エクスプローラがリアルタイム更新**
- **実行接地の自己修正**：設定の「検証コマンド」（例 `npm run build`）を、AI がファイルを変更した後に自動実行。**失敗すれば出力を AI に渡して直させ、通るまで再試行**（最大2回・既定OFF）
- **オート（自動振り分け）**：依頼の難易度を判定し チャット/Agent/ディープ推論 を自動選択（易しい依頼を高速・低コストに）
- **会話スレッドの複数管理**（名前付け・切替・削除）／**コスト上限アラート**／永続化はサイズ上限つきで安全（満杯でも落ちず、万一の表示エラーは**復旧画面**で回復）
- **@メンション**でワークスペースのファイルを文脈添付／**プロジェクト指示ファイル** `.lokicode/rules`(.md) を自動付与
- **並列サブタスク**（`parallel_query`）で複数調査を並行回収／エディタ右クリックの**クイックアクション**（選択範囲を 説明 / リファクタ / テスト生成）
- 全 OpenRouter モデルから選択（**コスト分類・コンテキスト長・ツール対応**、公開されていれば**知能/コーディング指数**を表示）／トークン・コスト使用量を表示

### ディープ推論（オーケストレータ型）
単発の API 呼び出しではなく、**設計ブリーフ（意図・成功基準・調査計画）→ 並列の接地調査 → 十分性ゲート → 証拠ベースのドラフト → 基準で採点する検証×N（合格で早期終了・低スコアは強モデルへ昇格）→ 最終合成**を行います。詳細は [v2 仕様](specs/deep-reasoning-v2.md) / [基盤設計](specs/architecture.md)。

- **広さ（調査 1–5）と深さ（検証 1–16）を分離**：広さで網羅性、深さで正確性
- **コスト効率ルーティング**：安価な思考モデルが量（調査・ドラフト）、高性能モデルが要所（計画・最終）を担当
- **強い検証器**：検証（採点）は**強モデル**で実行。思考モデルが無料/弱くても「賢さの壁」を満たし、誤り（例: 存在しないパス）を取りこぼさない
- **アンサンブル（Mixture-of-Agents）**：難課題ではドラフト/最終を複数生成→統合・選抜（**トグルで ON/OFF**、速度優先なら OFF）
- **接地と検証**：実ファイル・実コマンド結果で裏取りし `file:line` を引用。検証は欠陥列挙→改善の敵対的レビュー
- **オート（自動振り分け）**：依頼の難易度を1コールで判定し、チャット/Agent/ディープ推論を**自動で選択**（易しい依頼を高速・低コストに）。トグルで ON
- **送信前のコスト概算**（実使用量から自動補正）

### エディタ
Monaco ベース（VS Code のエディタ）。複数タブ・**分割表示**、**コマンドパレット**（Ctrl+Shift+P）/ **クイックオープン**（Ctrl+P）、**横断検索・置換**、**アウトライン/シンボル検索**（Ctrl+Shift+O）、タブのドラッグ並べ替え・ピン留め、**複数フォルダ（マルチルート）**、自動保存、ドラッグ＆ドロップで開く、ライト/ダークテーマ、起動状態の復元。

- **統合ターミナル**（Ctrl+J）— PTY ベース（xterm.js）。複数タブ・分割、Windows は **PowerShell**（履歴↑↓・Ctrl+R・タブ補完）、**コピー/ペースト**（Ctrl+Shift+C/V・Ctrl+V・Shift+Insert・右クリック）、1万行スクロールバック。
- **パネルのトグル**：Ctrl+B サイドバー / Ctrl+Alt+B AI エージェント / Ctrl+J ターミナル
- **設定**は左アクティビティバーの歯車から（API キー / ベース URL / 各モデル / **ループ上限・コマンドタイムアウト・検証コマンド** / キーバインド / GitHub 連携）

### Git / GitHub
- 変更一覧・ステージ・コミット、**差分表示**、**ブランチ切替/作成**、**pull / push**（ahead/behind）、**hunk 単位のステージ**
- **コミット履歴のグラフ表示**／ファイルの **blame**／エクスプローラの **Git 色分け**
- **GitHub ログイン**（OAuth Device Flow）でトークン認証、**PR / Issue 作成**

### 配布
インストール版は起動時に新版を検知し、アプリ内で自己更新（Tauri updater + GitHub Releases）。

---

## 開発・ビルド

```bash
npm run tauri dev     # デスクトップアプリとして起動（要 Rust）
npm run dev           # フロントエンドのみブラウザで確認（Tauri 機能は動かない）
npm run tauri build   # 配布用インストーラを生成
```

ビルド生成物（Windows）:

- インストーラ: `src-tauri/target/release/bundle/nsis/*.exe`（または `msi/*.msi`）
- 単体実行ファイル: `src-tauri/target/release/lokicode.exe`

---

## リリースと自動アップデート

インストール版は起動後に新バージョンを検知し、アプリ内で自己更新できます（Tauri updater + GitHub Releases）。

- **アプリ内**：起動時に自動で 1 回チェック（サイレント）。新版があれば上部バナーで案内し、「今すぐ更新して再起動」で適用。ヘッダ右の「更新を確認」で手動チェックも可能。
- **配布サーバ**：GitHub Releases（`loki-co-sudo/lokicode`）。エンドポイントは `…/releases/latest/download/latest.json`。成果物は minisign 鍵で署名し、埋め込み公開鍵で検証。

### リリース手順（自動化）

1. `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` の `version` を上げる。
2. `git tag vX.Y.Z && git push origin vX.Y.Z` を push。
3. GitHub Actions（`.github/workflows/release.yml`）が Windows でビルド・署名し、インストーラ・`.sig`・`latest.json` を添付した Release を公開。

### 必要な GitHub Secrets（リポジトリ設定で 1 回だけ登録）

| Secret | 値 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.lokicode/updater.key` の中身（全文） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 鍵生成時に設定したパスワード（無しなら空） |

> 秘密鍵・パスワードはリポジトリ外で保管してください（失うと更新に署名できません）。updater を含む最初の版だけは手動インストールが必要で、それ以降が自動更新の対象です。

---

## GitHub ログイン連携（オーナー設定）

設定画面の「GitHub アカウント連携」から OAuth Device Flow でログインでき、push / pull がトークン認証で通ります。利用には、オーナーが **GitHub OAuth App を 1 つ登録**して Client ID を埋め込みます（1 回だけ）:

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App。
2. **Enable Device Flow** にチェックを入れて作成。
3. 発行された **Client ID** を `src-tauri/src/github.rs` の `GITHUB_CLIENT_ID` に設定（Device Flow はシークレット不要・Client ID は埋め込み可）。

> トークンは OS のアプリ設定フォルダ（`github.json`）に保存されます。Client ID 未設定のうちは、ログイン時にその旨が表示されます。

---

## 環境変数

Rust バックエンドが読み込みます（`VITE_` プレフィックスは不要・フロントには公開されません）。

| 変数 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | ○ | — | OpenRouter の API キー |
| `OPENROUTER_MODEL` | — | `anthropic/claude-sonnet-4.6` | 既定モデル ID（未設定時のフォールバック） |

> モデル ID は OpenRouter 側で随時更新されます。基本はアプリ内のモデル選択（自動取得）から選んでください。
> キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`**。

---

## プロジェクト構成

```
src/
  App.tsx                 # レイアウト・タブ状態・サイドバー切替・選択をAIへ
  components/
    ActivityBar.tsx       # 左端のアクティビティバー（エクスプローラ/検索/Git/設定 切替）
    ErrorBoundary.tsx     # 表示エラーを捕捉する復旧画面（白画面化を防止）
    ExplorerPane.tsx      # フォルダツリー
    SearchPane.tsx        # ワークスペース横断の検索 / 一括置換
    TerminalPanel.tsx     # 統合ターミナル（Ctrl+J・PowerShell・コピペ・スクロールバック）
    CommandPalette.tsx    # コマンドパレット（Ctrl+Shift+P）/ クイックオープン（Ctrl+P）
    SourceControlPane.tsx # Git ソース管理（status/stage/commit/branch/pull/push/log）
    GitDiffView.tsx       # ファイルの unified diff を色付き表示
    BlameView.tsx         # git blame（行ごとの作者/コミット）表示
    CommitGraph.tsx       # コミット履歴のグラフ（レーン/ノード）描画
    GithubAccount.tsx     # GitHub Device Flow ログイン UI（設定画面に表示）
    UpdateBanner.tsx      # 起動時の更新チェック + 更新案内バナー
    EditorPane.tsx        # タブバー + ツールバー + Monaco エディタ
    ChatPane.tsx          # AI エージェント UI（ストリーミング・履歴永続化・文脈付与）
    Markdown.tsx          # AI 応答の Markdown 描画（表・ハイライト + コピー）
    ModelPicker.tsx       # 自動更新されるモデル選択（検索・コスト/プロバイダ絞り込み）
    SettingsPane.tsx      # 設定ペイン（API キー / モデル / 動作上限 / キーバインド / GitHub）
  lib/
    openrouter.ts         # バックエンド呼び出し（complete / chat_once / streamChat）・モデル一覧
    reasoning.ts          # ディープ推論コア（ブリーフ→調査→検証→合成のオーケストレータ）
    agent.ts              # エージェントループ・ツール定義・ツール実行・承認
    agentSettings.ts      # ループ上限・コマンドタイムアウト・既定思考モデル
    files.ts              # ファイル開く/保存・言語判定
    search.ts             # grep / list_files / replace_in_files のラッパ
    terminal.ts           # ターミナルの開始 / 入力 / 出力購読のラッパ
    recent.ts             # 最近開いたフォルダ/ファイルの記録
    github.ts             # GitHub ログイン（device flow）コマンドのラッパ
    updater.ts            # 更新チェック / ダウンロード / 再起動のラッパ
    chatStorage.ts        # 会話スレッド（複数）の localStorage 永続化（サイズ上限つき）
    cost.ts               # ディープ推論の送信前コスト概算（実使用から補正）
    useModels.ts          # モデル一覧取得フック
src-tauri/
  src/
    lib.rs                # プラグイン登録・ファイル IO / list_dir / run_command / open_devtools
    search.rs             # grep_search / list_files / replace_in_files
    terminal.rs           # 統合ターミナル（PTY・出力ストリーミング・リサイズ）
    git.rs                # Git コマンド（git CLI ラッパ）
    github.rs             # GitHub OAuth Device Flow・トークン保存・push/pull 認証
    openrouter.rs         # キー解決・complete / chat_once / streaming・モデル一覧・設定
  capabilities/default.json
specs/                    # 設計仕様（architecture.md / deep-reasoning-v2.md）
app-icon.svg / app-icon.png  # アイコン元データ（`npm run tauri icon` で再生成可能）
```

---

## セキュリティ

- API キーは **Rust プロセス側**で保持し、フロントエンド（webview）には渡しません。
- `.env` は `.gitignore` 済みです。`.env.example` には**実キーを入れない**でください。
- パッケージ版でのキーは OS のアプリ設定フォルダ（`openrouter.json`）に保存されます。
- ⚠️ **エージェントは実際にファイルを書き換え・コマンドを実行できます。** `write_file` / `run_command` は既定で**実行前に承認**を求めます。「自動承認」は内容を理解した上で使ってください。

---

## ロードマップ

当初のロードマップ項目はすべて実装済みです（「主な機能」を参照）。新しいアイデアは随時追記します。

- （候補）UI の多言語対応（i18n）— 日本語前提のため優先度は低め
