import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";
import "highlight.js/styles/github-dark.css";

// Apply the saved theme before first paint to avoid a flash.
if (localStorage.getItem("lokicode.theme") === "light") {
  document.documentElement.classList.add("light");
}

// F12 opens DevTools (works in release builds via the backend command).
window.addEventListener("keydown", (e) => {
  if (e.key === "F12") {
    e.preventDefault();
    invoke("open_devtools").catch(() => {});
  }
});

// Jank monitor: log any task that blocks the main thread ≥50ms as `[jank]`, so a
// UI freeze self-reports its duration in the F12 console without reading a flame
// chart. The `longtask` API only surfaces tasks ≥50ms, so every entry is a stall.
if (typeof PerformanceObserver !== "undefined") {
  try {
    let worst = 0;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const ms = Math.round(entry.duration);
        worst = Math.max(worst, ms);
        const attr = (entry as PerformanceEntry & { attribution?: { name?: string }[] })
          .attribution?.[0]?.name;
        console.log(`[jank] ${ms}ms main-thread block${attr ? ` · ${attr}` : ""}`);
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
    // Expose the worst stall so it can be checked from the console: __jankWorst()
    (window as unknown as { __jankWorst: () => number }).__jankWorst = () => worst;
  } catch {
    /* longtask not supported in this webview — skip */
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
