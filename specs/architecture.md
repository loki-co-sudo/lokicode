# lokicode アーキテクチャ仕様: Recurrent-Depth エージェント

> Kye Gomez の OpenMythos / Claude Mythos 5 から着想を得た、**推論時計算（Inference-Time
> Compute）を最大化する再帰深度ループ**を中核に据えたエージェント型エディタの設計。

## 1. ビジョンと原則

単一の API 呼び出しで答えを出すのではなく、**外部システム（lokicode）側で LLM を再帰的に
ループ・自己検証（Reflection）させる**ことで、安価なモデルでも推論能力を引き上げる。

- **P1 Recurrent-Depth Loop**: ドラフト → 内省（自己批判）→ 改善 を反復。
- **P2 Cost-Efficient Routing**: 思考フェーズは超軽量モデル、最終合成は高性能モデル。
- **P3 Adaptive Compute Control**: 思考深度（ループ回数）を 1〜16+ で UI から制御。

「脳（推論コア）」と「手（ツール実行エージェント）」を分離する。本仕様は主に脳側を定義し、
既存のツール実行エージェント（`read_file`/`write_file`/`list_dir`/`run_command`）を手として
位置づける。長期的には推論イテレーション中でツールを使えるよう統合する。

## 2. コンポーネント全体図

```
┌────────────────────────── Frontend (React/TS) ───────────────────────────┐
│  ChatPane                                                                 │
│   ├─ モード選択: [ディープ推論] / [エージェント(ツール)] / [チャット]      │
│   ├─ 思考深度スライダー (1–16)        ← P3 Adaptive Compute Control        │
│   └─ 思考ステップ表示 (draft / reflection×N / synthesis)                   │
│                                                                           │
│  lib/reasoning.ts   ← P1 Recurrent-Depth Loop の本体                       │
│  lib/agent.ts       ← ツール実行エージェント（既存）                       │
│  lib/openrouter.ts  ← invoke ラッパ (complete / chatOnce / streamChat)     │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ Tauri invoke
┌───────────────────────────────▼─────────────── Backend (Rust) ───────────┐
│  openrouter.rs                                                            │
│   ├─ complete(messages, model)   非ストリーミング単発補完（モデル指定可） │
│   ├─ chat_once(messages, tools)  ツール対応補完（エージェント用）         │
│   ├─ send_chat(...)              ストリーミング（プレーンチャット用）     │
│   ├─ resolve_key / resolve_model / settings（thinking/synthesis モデル）  │
│  lib.rs:  read_text_file / write_text_file / list_dir / run_command       │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ HTTPS
                          OpenRouter API (/chat/completions, /models)
```

## 3. Recurrent-Depth Loop（P1）

### 3.1 アルゴリズム

入力: `task`（ユーザー指示）, `context`（任意: 現在のファイル等）, `depth D`,
`thinkingModel T`, `synthesisModel S`。

```
base = [system, ...history, user(task)]   // context は system として base に含める

# Phase 0: ドラフト（T）
draft = complete(base + nudge("初期解と簡潔な理由"), T)
emit Thought("初期ドラフト", T, draft)

# Phase 1..D: 内省 & 改善（T）  ← 再帰深度
for k in 1..=D:
    reflect = complete(
        base + [assistant(draft),
                user("上記を批判的に検証し、誤り・不足・改善点を述べた上で、改善した完全な解を提示")],
        T)
    emit Thought("内省 k/D", T, reflect)
    draft = reflect
    if 収束シグナル(reflect): break      # 早期終了（任意）

# Phase Final: 最終合成（S）  ← 高性能モデルで仕上げ
final = complete(
    base + [assistant(draft),
            user("これまでの検討を踏まえ、ユーザー向けの最終回答を簡潔・正確にまとめる")],
    S)
emit Final(final)
```

API 呼び出し回数 = `1 (draft) + D (reflect) + 1 (synthesis)`。

### 3.2 早期終了（収束判定）

内省フェーズの出力に「これ以上の改善は不要 / CONVERGED」等が含まれたら打ち切る。
プロトタイプでは任意機能とし、まずは固定回数 D を基本とする。

### 3.3 Tool-Augmented Recurrent Depth（脳と手の融合）

各思考フェーズ（draft / 各 reflection）を、**ツール実行エージェントのミニループ**として実行する。
これにより、自己検証が「モデルの想像」ではなく**実ファイル・実コマンド結果に基づく事実**に
なる（例: ファイルを読んで前提を確認、テストを実行して動作確認してから改善）。

```
think(messages, model):
    if useTools:
        return runAgent(messages, model)   # ツール呼び出し→結果→… を内部で反復し最終テキストを返す
    else:
        return complete(messages, model)

# draft / reflection で think() を thinkingModel で呼ぶ（ツールは安価モデルで使う）
# synthesis は synthesisModel で think()（高性能モデルで最終化、必要ならツールで最終確認）
```

- `runAgent` は既存のツール実行エージェント（`read_file`/`list_dir`/`write_file`/`run_command`）。
  **モデル指定**を受け取れるよう拡張し、**最終アシスタントテキストを返す**。
- 承認フロー（write/コマンド）・**停止**・タイムアウトはエージェントと共通の仕組みを再利用。
- UI ではフェーズ内のツール実行をツールカードで、フェーズ結論を Thought カードで表示。

トグル `useTools`（「推論中にツールを使う」）で 3.1（純推論）と 3.3（ツール統合）を切替。

## 4. Cost-Efficient Routing（P2）

- **思考（draft / reflection）**: `thinkingModel`（超軽量・安価）。回数が多いほど効くため安価に。
- **最終合成（synthesis）**: `synthesisModel`（高性能: Fable / Opus 等）。1 回だけ高品質に。
- 既定値: 未設定時は通常の `model` にフォールバック（そのまま動く）。設定画面の
  ModelPicker（OpenRouter から自動取得した実在モデル一覧）から各々選択する。

## 5. Adaptive Compute Control（P3）

- ChatPane の入力欄付近に **思考深度スライダー (1–16)**。
- 値は localStorage に保存。`depth = 内省フェーズの反復回数`。
- 深度を上げる = 推論時計算を増やす（コスト・レイテンシと品質のトレードオフを UI で明示）。

## 6. バックエンド API（Rust コマンド）

| コマンド | 入力 | 出力 | 用途 |
|----------|------|------|------|
| `complete` | `messages: Value`, `model: Option<String>` | `String`（assistant content） | 推論コアの各フェーズ |
| `chat_once` | `messages`, `tools` | assistant message(Value) | ツール実行エージェント |
| `send_chat` | `messages`, channel | ストリーム | プレーンチャット |
| `get_settings` / `save_settings` | — / model, thinkingModel, synthesisModel, apiKey | status | 設定 |

設定ファイル `openrouter.json`（OS アプリ設定フォルダ）に
`api_key`, `model`, `thinking_model`, `synthesis_model` を保存。

## 7. フロントエンド・データモデル

会話トランスクリプトは `AgentItem[]`（localStorage 永続化）:

```ts
type AgentItem =
  | { kind: "user"; content }
  | { kind: "assistant"; content }                 // 最終回答（synthesis 等）
  | { kind: "thought"; label; model; content }      // ドラフト/内省（折りたたみ表示）
  | { kind: "tool"; name; args; status; result }    // ツール実行（既存）
```

## 8. プロトタイプ範囲（本コミット）

- [x] `/specs/architecture.md`（本書）
- [ ] Rust `complete(messages, model)` コマンド + 設定に thinking/synthesis モデル追加
- [ ] `lib/reasoning.ts`: 再帰深度ループ（draft→reflect×D→synthesis）
- [ ] ChatPane: ディープ推論モード + 深度スライダー + Thought カード表示
- [ ] SettingsModal: thinking/synthesis モデル選択

## 9. 今後（本書のスコープ外・将来拡張）

- [x] 推論イテレーション中の**ツール使用統合**（脳と手の融合, §3.3）
- [x] **収束ベースの早期終了**（内省が `CONVERGED` を返したら打ち切り §3.2）
- [x] フェーズ/ターンの**トークン・コスト計測の可視化**（OpenRouter `usage.include`）
- 動的深度（自己評価スコアで深度を自動調整）。
- 複数ドラフトの**並列生成 + 投票（self-consistency）**。
- 推論ログのエクスポート。
```
