# GitHub ログイン連携仕様（OAuth Device Flow）

GitHub アカウントでログインし、(1) push/pull の認証、(2) ユーザー情報の表示、
(3) 現在のリポジトリのコミット履歴一覧 を実現する。

## 認証方式：OAuth Device Flow

クライアントシークレット不要・リダイレクトサーバ不要で、デスクトップアプリに最適。

```
1. アプリ → POST github.com/login/device/code (client_id, scope)
          ← device_code, user_code, verification_uri, interval
2. アプリ: user_code を表示し、ブラウザで verification_uri を開く
3. ユーザー: ブラウザでコード入力 → 許可
4. アプリ → POST github.com/login/oauth/access_token を interval 間隔でポーリング
          ← access_token（authorization_pending の間は待機）
5. アプリ: GET api.github.com/user でユーザー情報取得 → トークンと共に保存
```

- **scope**: `repo read:user`（private 含む push/pull とユーザー情報）。
- **client_id**: 配布アプリでは秘密ではないので埋め込み。オーナーが GitHub で
  OAuth App を1つ登録し（Device Flow を有効化）、その Client ID を埋め込む。
  - バックエンドの定数 `GITHUB_CLIENT_ID`（初期値はプレースホルダ）。

## トークン保存

- 既存の設定保存（`openrouter.json`）と同じく、app_config_dir に `github.json` を作成。
  `{ token, login, name, avatarUrl }` を保存。
- ※ OS キーチェーンではなくローカル設定ファイル（既存 API キーと同水準）。README に明記。

## バックエンド（`src-tauri/src/github.rs`、新規）

| コマンド | 内容 |
| --- | --- |
| `github_device_start() -> DeviceCode` | device/user code と verification_uri, interval |
| `github_device_poll(app, device_code) -> PollResult` | 1回ポーリング。pending/slow_down/ok(token時はユーザー保存)/error |
| `github_user(app) -> Option<GithubUser>` | 保存済みユーザー（login/name/avatarUrl） |
| `github_logout(app)` | トークン削除 |

- `pub fn load_token(app) -> Option<String>` を公開し、`git.rs` の push/pull が利用。

## git 認証（`git.rs` の push/pull 拡張）

- トークンがあれば github.com 向けに認証ヘッダを注入してコマンド実行：
  `git -c http.https://github.com/.extraheader="AUTHORIZATION: basic <base64(x-access-token:TOKEN)>" push/pull`
- トークンが無ければ従来どおり（システムの資格情報ヘルパに委譲）。
- `git_push` / `git_pull` に `app: AppHandle` を追加（フロントの呼び出しは不変）。

## コミット履歴（`git.rs` に追加）

- `git_log(cwd, limit) -> Vec<GitCommit>`：
  `git log -n <limit> --pretty=%H%x1f%h%x1f%an%x1f%ad%x1f%s --date=short` を区切り解析。
- `GitCommit { hash, short, author, date, subject }`。

## フロント

- `src/lib/github.ts`：上記コマンドのラッパと型。
- ログイン UI：設定モーダル（`SettingsModal.tsx`）に「GitHub」セクション。
  - 未ログイン：「GitHub でログイン」→ device code 表示 + ブラウザを開く + 自動ポーリング。
  - ログイン済み：アバター + ユーザー名 + ログアウト。
- `SourceControlPane.tsx`：
  - ヘッダにログイン中ユーザーのアバター（小）を表示。
  - 「コミット履歴」セクションを追加（`git_log` の一覧、各行クリックでその commit の概要）。

## 完了の定義

- Device Flow ログイン → ユーザー表示、push/pull がトークン認証で通る、履歴一覧が出る。
- `README.md` を更新（機能・必要な OAuth App 登録手順・トークン保存場所の注意）。

## オーナーの手順（1回だけ）

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App。
2. **Enable Device Flow** にチェック。
3. 発行された **Client ID** を `GITHUB_CLIENT_ID` に設定（私が埋め込む）。
