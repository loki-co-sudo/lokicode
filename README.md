# lokicode

A minimal VS Code-style desktop code editor with a built-in AI chat panel, powered
by OpenRouter. Built with **Tauri v2 + React + TypeScript + Vite + Monaco + Tailwind CSS**.

## Features (MVP)

- Two-pane layout: **Monaco editor** on the left, **AI chat** on the right, with a
  draggable divider.
- A sample `index.js` file you can edit live.
- Chat panel that calls the OpenRouter chat-completions API (default model:
  `anthropic/claude-3.5-sonnet`, configurable).

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** toolchain (required by Tauri) — install via <https://rustup.rs>
- OS-specific Tauri prerequisites — see <https://tauri.app/start/prerequisites/>
  (on Windows: the **Microsoft C++ Build Tools** and **WebView2**, which ships with
  Windows 11).

## Setup

```bash
# 1. Install JS dependencies
npm install

# 2. Configure your OpenRouter API key
cp .env.example .env
# then edit .env and set VITE_OPENROUTER_API_KEY
```

Get an API key at <https://openrouter.ai/keys>.

## Run

```bash
# Desktop app (Tauri) — requires Rust:
npm run tauri dev

# Or just the web frontend in a browser (no Rust needed, for quick UI iteration):
npm run dev
```

## Build

```bash
npm run tauri build
```

## Environment variables

| Variable                  | Required | Default                        | Description              |
| ------------------------- | -------- | ------------------------------ | ------------------------ |
| `VITE_OPENROUTER_API_KEY` | Yes      | —                              | Your OpenRouter API key. |
| `VITE_OPENROUTER_MODEL`   | No       | `anthropic/claude-3.5-sonnet`  | Model id to use.         |

> Vite only exposes env vars prefixed with `VITE_` to the frontend. After changing
> `.env`, restart the dev server.

## Project structure

```
src/
  App.tsx                 # Two-pane layout + draggable divider
  main.tsx                # React entry, imports global CSS
  index.css               # Tailwind v4 entry
  lib/openrouter.ts       # OpenRouter API client
  components/
    EditorPane.tsx        # Monaco editor wrapper
    ChatPane.tsx          # Chat UI + send logic
src-tauri/                # Tauri (Rust) shell
```

## Security note

For simplicity this MVP reads the API key in the frontend (`import.meta.env`), so
the key ends up in the built JS bundle. **Do not ship this as-is.** For a real
release, move the OpenRouter call into a Tauri command (Rust side) and read the key
from the Rust process so it never reaches the webview.
