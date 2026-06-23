# Git 差分表示・ブランチ操作・push/pull 仕様

既存の Git ソース管理パネル（ステージ / アンステージ / コミット）を拡張し、
**ファイル差分の表示**・**ブランチ切替/作成**・**push / pull** を追加する。
すべて `git` CLI へのシェルアウトで実装（既存 `src-tauri/src/git.rs` の方針を踏襲）。

## 1. ファイル差分の表示

- ソース管理パネルでファイル行をクリックすると、エディタ領域に**差分ビュー**を開く。
  - 現状は「ファイルを開く」だけ。これを「差分を開く」に変更（差分ビュー内に "ファイルを開く" ボタンも置く）。
- 差分の対象:
  - ステージ済み行 → `git diff --cached -- <path>`（index vs HEAD）
  - 変更/未ステージ行 → `git diff -- <path>`（worktree vs index）
  - 追跡対象外（untracked）→ ファイル全体を追加行として表示（`git diff --no-index -- /dev/null <path>` 相当、無ければ全行 +）。
- バックエンドは **unified diff のテキスト**を返し、フロントが色付けして表示
  （`@@` ハンク見出し / `+` 追加 / `-` 削除 / 文脈行）。
  - 既存 `DiffPreview.tsx` は2つの内容を JS で diff する別用途なので、Git 用に
    unified diff をパース表示する `GitDiffView.tsx` を新設する。

## 2. ブランチ切替・作成

- パネルヘッダのブランチ名をクリック → ブランチ一覧ポップアップ。
  - ローカルブランチ一覧（現在ブランチに印）。
  - 選択で `git checkout <branch>` 相当（`git switch`）。
  - 「＋ 新しいブランチ」→ 名前入力 → `git switch -c <name>`。
- 切替後はステータスを再読込。未コミットの変更で失敗したらエラーを表示（強制はしない）。

## 3. push / pull と ahead/behind

- `git_status` を拡張し、上流に対する **ahead / behind** のコミット数を返す。
  - `git status --porcelain=v2 --branch` の `# branch.ab +A -B` 行を解析。
- ヘッダに **↓ pull** / **↑ push** ボタン（ahead/behind 件数をバッジ表示）。
  - pull: `git pull --ff-only`（失敗時はエラー表示）。
  - push: `git push`。上流未設定なら `git push -u origin <branch>`。
- 実行は時間がかかる/認証が要るので、ボタンは実行中 disabled、結果（成功/エラー）をパネルに表示。
  認証はシステムの git 資格情報ヘルパに委ねる（アプリでは資格情報を扱わない）。

## バックエンド（`src-tauri/src/git.rs`）追加コマンド

| コマンド | 内容 |
| --- | --- |
| `git_diff(cwd, path, staged) -> String` | unified diff テキストを返す |
| `git_branches(cwd) -> { current, branches: [] }` | ローカルブランチ一覧 |
| `git_switch(cwd, branch)` | 既存ブランチへ切替 |
| `git_create_branch(cwd, name)` | 新規作成して切替 |
| `git_pull(cwd) -> String` | `git pull --ff-only`、出力を返す |
| `git_push(cwd) -> String` | `git push`（必要なら `-u`） |

`GitStatus` に `ahead: u32` / `behind: u32` / `upstream: bool` を追加。

## フロント

- `src/lib/git.ts`: 上記コマンドのラッパと型を追加。
- `src/components/GitDiffView.tsx`: unified diff を色付け表示する新コンポーネント。
- `src/components/SourceControlPane.tsx`: ブランチ切替ポップアップ、push/pull ボタン、
  ファイルクリックで差分ビューを開く導線。
- `src/App.tsx`: 差分ビューをエディタ領域に表示する状態を追加（ファイルタブと併存）。

## 権限

- 追加の Tauri 権限は不要（すべて既存の `run_command` ではなく専用コマンド経由）。

## 完了の定義

- 差分表示・ブランチ切替/作成・push/pull が動作。
- `README.md` のロードマップと機能説明を更新（日本語）。
