# lokicode 自動アップデート仕様

インストール版が、起動後にアプリ内で新バージョンを検知して自己更新できるようにする。

## 仕組み（Tauri Updater + GitHub Releases）

```
[アプリ] --(1) latest.json を取得--> GitHub Releases
        <--(2) {version, notes, url, signature}--
[アプリ] --(3) version 比較 → 新しければ署名付きインストーラを DL & 検証 & 適用-->
        --(4) 再起動して新バージョンへ-->
```

- **置き場所（配布サーバ）**: GitHub Releases（無料）。
- **エンドポイント**: `https://github.com/<OWNER>/lokicode/releases/latest/download/latest.json`
- **署名**: minisign 鍵で更新パッケージに署名。アプリには**公開鍵**を埋め込み、改ざんを検証。
  - 秘密鍵はリポジトリ外（`~/.lokicode/updater.key`）に保管し、CI には GitHub Secret として渡す。

## コンポーネント

- フロント: `@tauri-apps/plugin-updater`（`check()` / `downloadAndInstall()`）、
  `@tauri-apps/plugin-process`（`relaunch()`）。
- バックエンド: `tauri-plugin-updater`, `tauri-plugin-process` を登録。
- 設定: `tauri.conf.json` の `plugins.updater`（endpoints, pubkey）と
  `bundle.createUpdaterArtifacts: true`（.sig と latest.json を生成）。
- 権限: `capabilities/default.json` に `updater:default`, `process:default`。

## UI / 挙動

- 設定画面に「**更新を確認**」ボタン＋状態表示（最新です / 新版あり → ダウンロード&再起動）。
- 起動時に**自動で 1 回チェック**（任意・サイレント）。新版があれば設定画面で知らせる。

## リリース手順（自動化: GitHub Actions）

`.github/workflows/release.yml`（`tauri-apps/tauri-action`）:

1. `v*` タグ push をトリガに Windows でビルド。
2. Secret の署名鍵で更新成果物に署名。
3. GitHub Release を作成し、インストーラ・`.sig`・`latest.json` を添付。

必要な GitHub Secrets:
- `TAURI_SIGNING_PRIVATE_KEY` … `~/.lokicode/updater.key` の中身
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` … 空（パスワード無しで生成）

## 利用者（プロジェクトオーナー）の手順

1. 無料の GitHub アカウント＋リポジトリ `lokicode` を作成。
2. 上記 2 つの Secret を登録。
3. `tauri.conf.json` の `<OWNER>` を自分のユーザー名に置換（本実装では確認後に確定）。
4. コードを push。以降は私がバージョンを上げてタグを打つと CI が公開し、インストール版が自己更新。

最初の **updater 入りバージョンだけは手動インストール**が必要（それ以降が自動）。

## 注意

- v0.2.0（updater 無し）からは自動更新できない。updater を入れた版を一度手動インストールしてから有効化。
- 秘密鍵/パスワードを失うと更新に署名できなくなる（鍵は大切に保管）。
