# 修正ロードマップ: ディープシンク 400 / Mac・Linux 対応 / ターミナルのシェル選択

対象読者: この repo を初めて触る AI エージェント。**上から順に、修正1 → 修正3 → 修正2 の順で実装する**
（修正2 は CI/リリース設定を触るためリスクが最大。独立しているので最後に回す）。
各修正は**別コミット**にする（コミット規約: English prefix + 日本語説明）。
作業前に CLAUDE.md の「開発ガイド」を必ず読むこと。特に:
- ループ開発（変更→ `npm test` / `npm run build` →修正、最大5回、同一エラー2連続で停止）
- 完了の定義（README を同じコミットで更新、証拠となるチェック出力を添付）

---

## 事前知識: LLM 呼び出しの経路（3つの修正すべての前提）

| 経路 | フロント | Rust | 使う機能 |
| --- | --- | --- | --- |
| Agent 単発モード | `src/lib/agent.ts` `runAgent()` → `src/lib/openrouter.ts` `chatOnceStream()` | `src-tauri/src/openrouter.rs` `chat_once_stream`（SSE ストリーミング + tools） | ツール呼び出し |
| ディープシンクの tools 無しフェーズ | `src/lib/reasoning.ts` `think()`（`o.tools === false`） → `openrouter.ts` `complete()` | `openrouter.rs` `complete`（非ストリーミング） | 素の completion |
| ディープシンクの tools 有りフェーズ | `think()` → `runAgent()` | `chat_once_stream` | ツール呼び出し |

**単発モードでは起きず、ディープシンクだけで 400 になる理由はメッセージ列の構造差にある。**
Agent 単発モードのメッセージ列は「system（先頭のみ）→ user/assistant 交互」という
どのプロバイダでも通る形。一方ディープシンクは `reasoning.ts` の各フェーズで:

```
[ ...base,                     // system×N → (user/assistant 履歴) → user(質問)
  ...ctx,                      // ← user の「後ろ」に system(ブリーフ/証拠/リポ地図) を注入
  { role: "assistant", content: draft },  // ← 機械的に組み立てた assistant。draft が空文字になり得る
  JUDGE ]                      // usr(...)（JUDGE/REFINE/FINAL/AGGREGATE/SELECT はすべて user ロール）
```

という**プロバイダによっては不正な形**を送る（`reasoning.ts:964` ほか）。

---

# 修正1: ディープシンク実行時の HTTP 400 を解消する

## 症状と原因候補

症状: thinking=DeepSeek 系 / synthesis=Claude 系の構成でディープシンクを実行すると
`API エラー (HTTP 400): ...` でタスクが停止。同じモデルは Agent 単発モードでは動く。

このコードベースで実際に 400 を作り得る経路（すべて潰す）:

1. **空 content のメッセージ**（最有力）
   - DeepSeek 系の reasoning モデルは、応答の本文を `message.reasoning` /
     `message.reasoning_content` に入れ、`message.content` が空になることがある。
     `openrouter.rs` の `complete` は `content` しか読まない（`openrouter.rs:367`）ため
     フェーズ出力 `draft` が空文字になる。
   - 空の `draft` が次フェーズで `{ role: "assistant", content: "" }` として注入され
     （`reasoning.ts:964,997,1006,1025,1046,1070`）、Anthropic 系プロバイダが
     「text content blocks must be non-empty」で 400 を返す。
   - 履歴由来の空 assistant（`ChatPane.tsx` `historyFromItems`）も同じ穴。
2. **会話途中の system ロール**: `base`（user で終わる）の後ろに
   `sys(ブリーフ)` / `sys(証拠)` / `sys(リポ地図)` を注入する。先頭以外の system を
   拒否するプロバイダがある。
3. **同一ロールの連続**: user(質問) の直後に user(JUDGE) 等が並ぶ経路がある。
   連続同ロールを拒否するプロバイダ（DeepSeek 系に前例）がある。
4. **末尾 assistant の末尾空白**: Anthropic 系は最終 assistant メッセージの
   trailing whitespace で 400 を返す（現状の呼び出し形では末尾は user だが、防御する）。

## 手順

### Step 0 — 診断情報の強化（最初にやる。以後のデバッグが桁違いに楽になる）

1. `src-tauri/src/openrouter.rs` `complete`（364行付近）: エラー文字列に**モデル名**を含める。
   ```rust
   return Err(format!("API エラー (HTTP {status}, model={model}): {detail}"));
   ```
   `chat_once_stream`（447行付近）も同様に `model=` を足す。
2. `src/lib/reasoning.ts` `think()`（526行〜）: 呼び出し全体を try/catch し、
   失敗時は `console.error("[deepthink] phase failed", { tag, model })` を出してから
   `フェーズ「${tag}」でエラー（モデル: ${model || "(default)"}）: ${元メッセージ}` に
   包み直して再 throw。**どのフェーズ・どのモデルで落ちたか**が UI のエラー表示に出るようになる。

### Step 1 — メッセージ正規化層 `src/lib/messages.ts`（新規・純関数）

`export function sanitizeMessages(messages: ApiMessage[]): ApiMessage[]` を実装。
**規則と適用順**（この順序どおりに実装する）:

1. `content === null` は `tool_calls` を持つ assistant のみ許容。それ以外は空文字とみなす。
2. content が空白のみのメッセージを**削除**する（`tool_calls` 付き assistant と
   `role:"tool"` は削除しない）。
3. **先頭から連続する system ブロックはそのまま**。それより後に現れる system は
   `role:"user"` に変換し、本文の先頭に `【コンテキスト】\n` を付ける
   （順序を保つ。先頭へ巻き上げると「上の候補ドラフト」等の相対参照が壊れるため移動はしない）。
4. 変換後、**連続する同一ロール**（user 同士・assistant 同士・system 同士）を
   `"\n\n"` で 1 メッセージに**結合**する（`tool_calls` 付き assistant と `tool` は結合対象外）。
5. 末尾が assistant なら content の末尾空白を `trimEnd()` する。

適用箇所は **`src/lib/openrouter.ts` の 2 箇所だけ**（Rust は触らない）:
- `complete()`: `invoke("complete", { messages: sanitizeMessages(messages), ... })`
- `chatOnceStream()`: 同様に入口で適用。

### Step 2 — 空出力を下流に流さないガード

1. `src-tauri/src/openrouter.rs` `complete`: `content` が空のとき
   `message.reasoning_content` → `message.reasoning` の順にフォールバックして読む
   （reasoning モデル対策）。
   ```rust
   let msg = &json["choices"][0]["message"];
   let content = ["content", "reasoning_content", "reasoning"]
       .iter()
       .find_map(|k| msg[*k].as_str().filter(|s| !s.trim().is_empty()))
       .unwrap_or("")
       .to_string();
   ```
2. `src/lib/reasoning.ts` `think()`: 戻り値が空白のみだったら**1回だけ**同じ呼び出しを
   リトライし、それでも空なら
   `フェーズ「${tag}」が空の出力を返しました（モデル: ...）。モデルを変えて再実行してください。`
   を throw する。**空文字をドラフト・証拠として次フェーズに流してはいけない**
   （CLAUDE.md「上限・打ち切り・フォールバック」の教訓 1.7.x と同型の事故になる）。
   - 注: キャンセル時（`opts.signal.aborted` / バックエンドの `cancel_run`）は
     `complete` が意図的に空を返す仕様。throw の前に `aborted()` を確認し、
     中断中なら従来どおり静かに return する。
   - リトライは異常系限定のため `cost.ts` の `pipelineShape` は**変更しない**
     （概算は正常系の呼び出し回数のみを数える方針。この方針コメントを pipelineShape 冒頭に1行追記）。

### Step 3 — テスト（空振りテスト禁止 — CLAUDE.md 3章の型に従う）

`src/lib/messages.test.ts` を新規作成。各規則につき**発動したこと自体を assert**:
- 空 assistant を含む配列 → 出力の件数が減っている & 空メッセージが存在しない。
- user の後に system → 出力でその位置のロールが user になり本文が `【コンテキスト】` で始まる。
  先頭の system は system のまま（両方向を assert）。
- user, user 連続 → 1 件に結合され本文に両方含まれる。
- `tool_calls` 付き assistant（content: null）→ 削除も結合もされない。
- 末尾 assistant の `"answer \n"` → `"answer"`。

### Step 4 — 検証

1. `npm test` / `npm run build` / `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
2. **実走（有料）**: thinking に DeepSeek 系・synthesis に Claude 系を設定し、
   ディープシンク ON（深さ3・広さ2）で実行。F12 コンソールの `[deepthink]` ログで
   全フェーズ完走・400 なしを確認する。
   **実走はユーザーに実施可否を確認し、未実施なら「未計測」と明示して報告する**（勝手にスキップ扱いにしない）。

コミット例: `fix: ディープシンクのメッセージ列を正規化して 400 エラーを解消（空content・途中system・連続同ロール対策）`

---

# 修正2: Mac / Linux 対応

## 現状把握（すでにできていること）

Rust 側はほぼクロスプラットフォーム対応済み。**壊さないこと**:
- `src-tauri/src/terminal.rs:40` — 非 Windows は `$SHELL`（fallback bash）で PTY 起動。
- `src-tauri/src/lib.rs:106` — 非 Windows の `run_command` は `sh -c`。
- `src-tauri/src/git.rs:75` — `CREATE_NO_WINDOW` は `#[cfg(windows)]` 限定。
- `src-tauri/tauri.conf.json` — `targets: "all"`、icon に `.icns` / `.ico` / `.png` あり。

残っているのは **(A) フロントの Windows 決め打ち** と **(B) CI / リリースのビルド対象**。

## 手順

### Step 1 — OS 情報の単一ソースを作る（Rust コマンド）

`src-tauri/src/lib.rs` に追加し `invoke_handler` に登録:
```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo { os: String, shell: String }

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(), // "windows" | "macos" | "linux"
        shell: default_shell_name(),          // 下記の共通関数
    }
}
```
`default_shell_name()` は terminal.rs / lib.rs に重複しているシェル解決ロジックを
1 つの共通関数に切り出して実装する（Windows: pwsh か powershell、Unix: `$SHELL` の basename か sh）。
フロント側は `src/lib/` に薄いラッパ（起動時に一度取得してキャッシュ）を置く。

### Step 2 — システムプロンプトと UI 文言の脱・Windows 決め打ち

1. `src/components/ChatPane.tsx` `buildSystemPrompt()`（106〜108行）:
   `running on Windows (shell: PowerShell)` と PowerShell 構文の指示を、Step 1 の
   `PlatformInfo` を引数に取って分岐させる。非 Windows 用の文面:
   - `running on ${os} (run_command executes via sh -c)`
   - 「POSIX シェル構文を使う。パスは `/` 区切りの絶対パス」
   - 118行の `Use absolute Windows paths.` も OS で出し分け。
2. `ChatPane.tsx:1212` の承認ダイアログ `（Windows・cmd）` → OS とシェル名を動的に。
3. `src/lib/agent.ts:178` の run_command ツール説明文
   （"On Windows this runs via PowerShell..."）はモデルへの説明なのでこのままで良いが、
   可能なら `TOOLS` を関数化せず文言だけ両 OS を併記する形に微修正（任意）。

### Step 3 — パス処理の OS 差異

1. `src/lib/agent.ts:293` `normAbs()`: 無条件 `toLowerCase()` は **Linux（大文字小文字を
   区別する FS）でワークスペース封じ込め判定が甘くなる**。モジュールに
   `let caseInsensitive = true` を置き、Step 1 の os 取得後に `linux` なら false に
   設定する初期化関数を追加（テストから注入できるよう export）。macOS は既定 FS が
   大文字小文字非区別なので true のまま。
   テスト: linux モードで `/Home/X` と `/home/x` が「別パス」と判定されることを assert。
2. `src/lib/evidenceCache.ts:60` `CITATION`: 現在は Windows 絶対パス
   （`C:\...`）と相対パスのみ。POSIX 絶対パス枝 `\/[^\s:*?"<>|]+?\.[a-z0-9]+` を
   選択肢の 2 番目に追加（`/Users/x/proj/src/a.ts:12` がマッチするテストを追加）。
3. `src/lib/reasoning.ts:43` `isAbsolute` は `/` 始まりに対応済み — 変更不要（確認のみ）。
4. `src/lib/keybindings.ts:57` は `e.ctrlKey || e.metaKey` を統合済みで macOS の
   Cmd がそのまま効く — 変更不要（確認のみ）。

### Step 4 — CI をクロスプラットフォーム化（`.github/workflows/ci.yml`）

`rust` ジョブを matrix 化: `runs-on: [windows-latest, macos-latest, ubuntu-22.04]`。
ubuntu には Tauri v2 のビルド依存を入れるステップを追加:
```yaml
- name: Install Linux dependencies
  if: runner.os == 'Linux'
  run: |
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
これが**Mac/Linux 対応の検証手段**になる（開発機は Windows なので、CI の
3 OS ビルド通過をもって「動く」の根拠とする。実機スモークテストは可能ならユーザーに依頼）。

### Step 5 — リリースを 3 OS 化（`.github/workflows/release.yml`）

`release` ジョブを matrix 化する。tauri-action は同じタグに対して各 OS の成果物を
同一 Release にアップロードし、`createUpdaterArtifacts: true` により
`latest.json` に各プラットフォームのエントリが載る:
```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - platform: windows-latest
        args: ""
      - platform: macos-latest        # Apple Silicon
        args: "--target aarch64-apple-darwin"
      - platform: macos-latest        # Intel
        args: "--target x86_64-apple-darwin"
      - platform: ubuntu-22.04
        args: ""
runs-on: ${{ matrix.platform }}
```
- macOS の 2 target は `dtolnay/rust-toolchain` の `targets:` に
  `aarch64-apple-darwin,x86_64-apple-darwin` を指定（macos ジョブのみ）。
- Linux 依存パッケージのインストールステップを Step 4 と同じ内容で追加。
- tauri-action の `with:` に `args: ${{ matrix.args }}` を追加。
- **注意**: macOS は Apple Developer 証明書がないため未署名配布になる
  （初回起動時に Gatekeeper 警告 → 右クリック→開く）。署名・公証は本修正の
  スコープ外であることを README に明記する。

### Step 6 — README 更新（同一コミット）

- 「対応 OS」節を追加（Windows / macOS / Linux、macOS の未署名注意、Linux の
  ビルド時 apt 依存一覧）。
- 「リリース手順」にビルドが 3 OS の matrix で走ることを追記。

### Step 7 — 検証

1. `npm test` / `npm run build` / ローカル `cargo clippy`（Windows 分は従来どおり）。
2. ブランチを push して CI の 3 OS ジョブが全部緑になることを確認（これが完了条件）。
3. リリース workflow はタグ push 時のみ発火するため、`v*` タグはユーザーの指示があるまで打たない。

コミット例: `feat: macOS / Linux 対応（プロンプトとパス処理の脱Windows決め打ち・CI/リリースの3OS化）`

---

# 修正3: ターミナルのシェル選択

## 設計方針

- **対象は統合ターミナル（PTY）のみ**。エージェントの `run_command` のシェルは従来どおり
  （Windows: pwsh/powershell、Unix: sh）。混ぜると承認 UI・安全分類（`commandRisk` は
  PowerShell/POSIX 両対応の read-only 判定）に波及するため、スコープ外と spec に明記する。
- 設定は既存パターンに従い localStorage（`lokicode.terminalShell`、空文字 = 自動 = 従来挙動）。
  適用タイミングは「**次に開くターミナルから**」（既存セッションは殺さない）。

## 手順

### Step 1 — spec を書く（specs-first）

`specs/terminal-shell-selection.md` に動機・検出方法・UI・「検証」節を書く。
検証節: 単体テスト + 実機で 2 種類以上のシェルを切り替えて新規ターミナルが
そのシェルで起動すること（プロンプト表示で判別）。

### Step 2 — Rust: シェル列挙と起動引数（`src-tauri/src/terminal.rs`）

1. `list_shells` コマンドを追加（`lib.rs` の `invoke_handler` に登録）:
   - Windows: `["pwsh", "powershell", "cmd"]` のうち PATH に実在するもの
     （既存 `crate::win_which("pwsh.exe")` 等を利用。`bash.exe` が PATH にあれば
     `"bash"` も加える — Git Bash 想定。`C:\Windows\System32\bash.exe`（WSL）は
     紛らわしいので **PATH 検出のみ**とし特別扱いしない）。
   - Unix: `/etc/shells` を読んで実在するパス + `$SHELL` を先頭に、重複除去。
   - 戻り値: `Vec<ShellInfo { id: String, label: String }>`（id は実行に使う名前/パス、
     label は表示名。例 id=`pwsh` label=`PowerShell 7`、id=`/bin/zsh` label=`zsh`）。
2. `terminal_start` に `shell: Option<String>` を追加し、`shell()` 関数を
   `shell(preferred: Option<&str>) -> CommandBuilder` に変更:
   - `preferred` があり実在すればそれを使う。Windows で pwsh/powershell の時だけ
     `-NoLogo` を付ける（cmd には付けない）。
   - 実在しない・空なら従来の既定にフォールバック（エラーにしない。落ちる場合は
     spawn 失敗時の既存エラー文言にシェル名を含める）。
   - フロントの既存呼び出しは `shell: null` で従来挙動 — **後方互換を壊さない**。

### Step 3 — フロント配線

1. `src/lib/terminal.ts`: `terminalStart(id, cwd, rows, cols, shell?: string | null)` に
   拡張し、`listShells(): Promise<{id: string; label: string}[]>` を追加。
2. `src/lib/agentSettings.ts`: `getTerminalShell(): string`（既定 ""）/
   `setTerminalShell(v: string)` を追加（localStorage キー `lokicode.terminalShell`）。
   `agentSettings.test.ts` に既定値・往復のテストを追加。
3. `src/components/TerminalPanel.tsx`: タブバー右端にシェル選択 `<select>` を追加。
   - 選択肢は「自動（既定）」+ `listShells()` の結果（マウント時に一度取得）。
   - 変更時 `setTerminalShell()`。ツールチップ:「新しく開くターミナルから適用されます」。
   - 新規ターミナル起動箇所（`terminalStart` 呼び出し）に
     `getTerminalShell() || null` を渡す。

### Step 4 — 検証

1. `npm test` / `npm run build` / `cargo clippy -- -D warnings`。
2. 実機（Windows）: 「自動 → cmd → pwsh」と切り替えて新規ターミナルを開き、
   それぞれのシェルで起動することを確認。既存タブが影響を受けないことも確認。
3. README の「ターミナル」節にシェル選択を追記（同一コミット）。

コミット例: `feat: 統合ターミナルのシェル選択（pwsh/powershell/cmd・Unixは/etc/shells検出）`

---

# 全体の完了チェックリスト（毎コミット）

1. `npm test` 通過（出力末尾を証拠として報告に添付）。
2. `npm run build` 通過。Rust を触ったコミットは `cargo clippy --all-targets -- -D warnings` も。
3. README.md を同じコミットで更新（日本語）。
4. 呼び出し回数が変わる変更はしていない（修正1のリトライは異常系のみ = `pipelineShape` 不変）。
5. 有料の実走検証（修正1 Step 4-2）は実施可否をユーザーに確認し、未実施なら「未計測」と明示。
