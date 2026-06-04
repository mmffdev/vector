import "@testing-library/jest-dom/vitest";

// jsdom 25 (the version pinned via vitest 2.1.x) ships a `localStorage`
// object whose methods are non-callable stubs in this config — `typeof
// localStorage === "object"` but `localStorage.setItem` is `undefined`,
// so any read/write throws. Several modules (authChannel's rotation
// marker, the F5 catalogue chip persistence) legitimately use Web Storage
// and guard it with try/catch for private-mode browsers, which means the
// broken jsdom stub silently no-ops instead of round-tripping. Install a
// real in-memory Storage shim so storage-backed code is actually
// exercised under test. Same-origin, per-process, cleared by callers.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.setItem !== "function") {
  const makeStorage = (): Storage => {
    let store: Record<string, string> = {};
    return {
      get length() { return Object.keys(store).length; },
      clear() { store = {}; },
      getItem(key: string) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      key(index: number) { return Object.keys(store)[index] ?? null; },
      removeItem(key: string) { delete store[key]; },
      setItem(key: string, value: string) { store[key] = String(value); },
    } as Storage;
  };
  Object.defineProperty(globalThis, "localStorage", { value: makeStorage(), configurable: true, writable: true });
  if (typeof globalThis.window !== "undefined") {
    Object.defineProperty(globalThis.window, "localStorage", { value: globalThis.localStorage, configurable: true, writable: true });
  }
}
