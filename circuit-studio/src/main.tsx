import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { PerfHarness } from "./perf/PerfHarness.tsx";
import { installStudioDebug } from "./sim/debug.ts";
import "./index.css";

installStudioDebug();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root element missing in index.html");
}

const view = new URLSearchParams(globalThis.location.search).get("view");

createRoot(rootElement).render(
  <StrictMode>{view === "perf" ? <PerfHarness /> : <App />}</StrictMode>,
);
