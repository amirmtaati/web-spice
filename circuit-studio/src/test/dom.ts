/**
 * DOM registration for component tests (ADR 007). Engine packages never
 * import this file, so `bun test spicekit` stays DOM-free.
 *
 * Call `setupDom()` FIRST in every DOM-dependent test file, before importing
 * any component module. ES imports hoist, so the import evaluates this
 * module's side effects — happy-dom registration — before React/Radix load.
 * That order is load-bearing: `@radix-ui/react-use-layout-effect` captures
 * `React.useLayoutEffect` at module-evaluation time only when
 * `globalThis.document` exists; otherwise every Radix portal silently never
 * mounts. The `setupDom()` call itself registers this file's RTL cleanup hook
 * (bun shares the module cache across test files, so module-level `afterEach`
 * would only ever run for the first importing file).
 */

import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

if (typeof window === "undefined") {
  GlobalRegistrator.register();
  const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
}

// happy-dom gaps that Radix/RTL rely on (idempotent):
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// RTL's automatic cleanup relies on a global `afterEach`, which bun does not
// inject — without this, rendered DOM leaks across tests AND test files.
export function setupDom(): void {
  afterEach(() => {
    cleanup();
  });
}
