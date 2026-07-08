# 統合ターミナルのシェル選択

対象: `specs/fix-roadmap-deepthink-400-crossplatform-shell.md` 修正3。
`fix-roadmap` の Step 1〜4 の実装記録を兼ねる。

## 動機

統合ターミナル（PTY・`src-tauri/src/terminal.rs`）は起動シェルを固定で決め打ちしている
（Windows: pwsh があれば pwsh、なければ powershell／Unix: `$SHELL` か bash）。
cmd 派・zsh/fish 派のユーザーが毎回手動で `cmd` や別シェルに切り替える手間を無くす。

## スコープ

- **対象は統合ターミナル（PTY）のみ**。エージェントの `run_command` のシェルは従来どおり固定
  （Windows: pwsh/powershell、Unix: `sh -c`）。混ぜると承認 UI・安全分類
  （`agent.ts` の `commandRisk` は PowerShell/POSIX 両対応の read-only 判定）に波及するため
  スコープ外とする。
- 設定は localStorage（`lokicode.terminalShell`、空文字 = 自動 = 従来挙動）。
  適用タイミングは「**次に開くターミナルから**」（既存セッションは殺さない）。

## 検出方法

- **Windows**: `pwsh` / `powershell` / `cmd` を `win_which`（`lib.rs` 既存の PATH 探索）で
  実在確認。`bash.exe` が PATH にあれば「Git Bash」として追加（`C:\Windows\System32\bash.exe`
  = WSL の bash と紛らわしいが、PATH 検出のみとし特別扱いしない）。
- **Unix**: `/etc/shells` を読んで実在するパスを列挙し、`$SHELL` を先頭に重複除去して追加。

## API

- `list_shells() -> Vec<ShellInfo { id, label }>`（新規 Tauri コマンド）。
  `id` は起動に使う名前/パス（Windows は `"pwsh" | "powershell" | "cmd" | "bash"`、
  Unix はシェルの絶対パス）。`label` は UI 表示名。
- `terminal_start(..., shell: Option<String>)`: `shell()` 関数を
  `shell(preferred: Option<&str>) -> CommandBuilder` に変更。
  - `preferred` が実在すればそれを使う（Windows で pwsh/powershell の時だけ `-NoLogo`）。
  - 実在しない・空なら従来の既定にフォールバック（エラーにしない）。
  - フロントの既存呼び出しは `shell: null` で従来挙動（後方互換）。

## フロント

- `src/lib/terminal.ts`: `terminalStart(id, cwd, rows, cols, shell?)` / `listShells()`。
- `src/lib/agentSettings.ts`: `getTerminalShell()` / `setTerminalShell(v)`
  （localStorage キー `lokicode.terminalShell`、既定 ""）。
- `src/components/TerminalPanel.tsx`: タブバー右端に `<select>`。
  「自動（既定）」+ `listShells()` の結果（マウント時に一度取得）。
  変更は `setTerminalShell()` するのみで、既存タブには影響しない
  （新規ターミナル起動箇所に `getTerminalShell() || null` を渡す）。

## 検証

- 単体テスト: `agentSettings.test.ts` に既定値・往復のテストを追加。
- 実機（Windows・ユーザー確認が必要）: 「自動 → cmd → pwsh」の順に切り替えて新規ターミナルを
  開き、それぞれのシェルで起動すること（プロンプト表示で判別）・既存タブが影響を受けないこと
  を確認する。
