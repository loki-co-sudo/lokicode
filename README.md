# lokicode

OpenRouter 経由で AI チャットを使える、**VS Code 風のデスクトップコードエディタ**です。
左にエディタ、右に AI チャットを備え、ローカルファイルの編集と AI への相談を 1 画面で行えます。

**技術スタック:** Tauri v2 + React + TypeScript + Vite + Monaco Editor + Tailwind CSS

## 主な機能

- 📝 **Monaco エディタ**（VS Code と同じエディタコンポーネント）
- 🗂️ **複数タブ**（新規 / 開く / 閉じる、タブごとの未保存表示、閉じる時に確認）
- 💬 **AI チャット**（OpenRouter 経由、**ストリーミング応答**対応）
- ✨ **AI 応答の Markdown 表示**（コードのシンタックスハイライト＋コピー、表など GFM 対応）
- 🤖 **モデル選択は自動更新**（OpenRouter から一覧を動的取得。ヘッダー / 設定で切替、⟳ で再取得）
- 📎 **選択コードを AI へ**（エディタの選択範囲をワンクリックでチャットへ）／**現在のファイルを文脈に含める**トグル
- 💾 **チャット履歴の永続化**（再起動後も復元）＋クリア
- 📂 **ローカルファイルの開く / 保存**（`Ctrl+S` 対応、拡張子から言語を自動判定）
- ↔️ 左右ペインは**ドラッグでリサイズ可能**
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

## 環境変数

Rust バックエンドが読み込みます（`VITE_` プレフィックスは不要・フロントには公開されません）。

| 変数                  | 必須 | デフォルト                     | 説明                         |
| --------------------- | ---- | ------------------------------ | ---------------------------- |
| `OPENROUTER_API_KEY`  | ○    | —                              | OpenRouter の API キー       |
| `OPENROUTER_MODEL`    | —    | `anthropic/claude-3.5-sonnet`  | 使用するモデル ID            |

キーの解決順は **アプリ設定ファイル > 環境変数 / `.env`** です。

## プロジェクト構成

```
src/
  App.tsx                 # レイアウト・タブ状態・Ctrl+S・選択をAIへ・設定モーダル
  components/
    EditorPane.tsx        # タブバー + ツールバー + Monaco エディタ
    ChatPane.tsx          # チャット UI（ストリーミング・履歴永続化・文脈付与）
    Markdown.tsx          # AI 応答の Markdown 描画（ハイライト + コピー）
    ModelPicker.tsx       # 自動更新されるモデル選択コンボボックス
    SettingsModal.tsx     # API キー / モデル設定
  lib/
    openrouter.ts         # バックエンド呼び出し（invoke + Channel）・モデル一覧
    files.ts              # ファイル開く/保存・言語判定
    chatStorage.ts        # チャット履歴の localStorage 永続化
    useModels.ts          # モデル一覧取得フック
src-tauri/
  src/
    lib.rs                # プラグイン登録・ファイル IO コマンド
    openrouter.rs         # キー解決・ストリーミング・モデル一覧・設定保存
  capabilities/default.json
app-icon.svg / app-icon.png  # アイコン元データ（`npm run tauri icon` で再生成可能）
```

## セキュリティ

- API キーは **Rust プロセス側**で保持し、フロントエンド（webview）には渡しません。
- `.env` は `.gitignore` 済みです。`.env.example` には**実キーを入れない**でください。
- パッケージ版でのキーは OS のアプリ設定フォルダ（`openrouter.json`）に保存されます。

## 拡張予定（ロードマップ）

> 今後追加したい機能のメモ。優先度順ではありません。チェック済みは実装済み。

- [x] **複数タブ**（新規 / 開く / 閉じる、未保存確認）
- [x] AI 応答の **Markdown レンダリング**（コードブロックのシンタックスハイライト・コピー）
- [x] **選択中のコードを AI に送る**（差分適用は未対応）
- [x] **チャット履歴の永続化**（再起動後も復元）
- [x] **モデル切替 UI**（OpenRouter から一覧を自動取得）
- [x] エディタの現在ファイル内容を**コンテキストとして付与**（トグル）
- [ ] **エクスプローラ**（フォルダを開いてファイルツリー表示）
- [ ] AI の提案をエディタに**差分適用**
- [ ] **テーマ切替**（ライト / ダーク、配色プリセット）
- [ ] **自動アップデート**（Tauri updater）
- [ ] 最近開いたファイル、複数ファイル横断の検索
- [ ] **検索 / 置換**、コマンドパレット
```
