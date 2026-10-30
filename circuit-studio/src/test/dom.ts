/**
 * DOM registration for component tests (ADR 007). Import this file FIRST in
 * every component test — engine packages never import it, so `bun test
 * spicekit` stays DOM-free.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") {
  GlobalRegistrator.register();
  const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
}

// happy-dom gaps that Radix/RTL rely on:
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
