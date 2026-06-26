// Use the locally-bundled monaco-editor instead of the jsdelivr CDN that
// @monaco-editor/react loads by default. Two wins:
//   1. the editor works fully offline (the CDN load otherwise breaks with no net),
//   2. the app can ship a strict CSP with no external script source.
// Language services run in web workers, wired through Vite's `?worker` imports so
// they load from the app bundle ('self'), not a CDN.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

const env: monaco.Environment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = env;

// Point @monaco-editor/react at the bundled monaco (skips the CDN loader).
loader.config({ monaco });
