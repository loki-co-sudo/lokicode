# lokicode

OpenRouter 経由で AI チャットを使える、VS Code 風のデスクトップコードエディタ。
Tauri v2 + React + TypeScript + Vite + Monaco + Tailwind CSS。

## 開発

```bash
npm run tauri dev     # デスクトップアプリ（要 Rust）
npm run dev           # フロントエンドのみ（ブラウザ）
```

API キーは `.env`（`.gitignore` 済み）の `VITE_OPENROUTER_API_KEY` から読み込む。
`.env.example` には実キーを入れないこと（プレースホルダのみ）。

## コミット規約

- コミットメッセージは **English のプレフィックス**（`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` など）+ **日本語の説明**で書く。
  - 例: `feat: AIチャットのストリーミング応答に対応`
