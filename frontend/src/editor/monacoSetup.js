// Loads Monaco from the app bundle instead of the jsDelivr CDN that
// @monaco-editor/react uses by default. Imported only by the (lazy-loaded)
// code editor page, so none of this is downloaded until the editor opens.
//
// Language definitions are registered up front but their tokenizers are
// lazy chunks; the language services run in the web workers below.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new TsWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "json":
        return new JsonWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });
