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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
