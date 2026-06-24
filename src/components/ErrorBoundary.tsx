import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Render a pane-sized (h-full) fallback instead of full-screen. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * App-wide safety net. Without this, any uncaught render/effect error unmounts
 * the whole React tree and leaves a blank window — and if the trigger is
 * persisted (e.g. corrupted/oversized localStorage), it recurs on every launch.
 * Here we instead show a recovery screen with a way to clear chat data.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  clearChatData = () => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("lokicode.chat") || key === "lokicode.threads" || key === "lokicode.activeThread") {
          localStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className={
          "flex flex-col items-center justify-center gap-4 bg-[#1b1b1c] p-8 text-center text-neutral-300 " +
          (this.props.compact ? "h-full" : "h-screen")
        }
      >
        <div className="text-2xl">⚠️</div>
        <h1 className="text-lg font-semibold text-neutral-100">表示中に問題が発生しました</h1>
        <p className="max-w-md text-sm text-neutral-400">
          再読み込みで復帰しない場合は、会話データの初期化をお試しください
          （AI エージェントの履歴のみ削除され、ファイルや設定は残ります）。
        </p>
        <pre className="max-h-32 max-w-md overflow-auto rounded bg-black/30 p-2 text-left text-[11px] text-red-300">
          {this.state.error.message}
        </pre>
        <div className="flex gap-3">
          <button
            onClick={this.reset}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            再読み込み
          </button>
          <button
            onClick={this.clearChatData}
            className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            会話データを初期化して再読み込み
          </button>
        </div>
      </div>
    );
  }
}
