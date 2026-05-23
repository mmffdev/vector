// Module-level registry shared between ScopeContext (writer) and
// AuthContext.switchWorkspace (reader). Extracted from Sentinel.tsx to
// break the runtime import cycle AuthContext → Sentinel → ScopeContext
// → Sentinel — Sentinel pulls useAuth + useScope for its composed view,
// which made any non-Sentinel consumer of the registry a cycle edge.
//
// A function (not a setter) so the registration site can register the
// freshest reload reference on every render — the reader always sees
// the latest closure.
//
// Defaults to a no-op so AuthContext.switchWorkspace works even when
// ScopeProvider is not mounted (e.g. /(overlay)/topology route, login
// pages, server-rendered shells before the user layout boots).

let _scopeReload: () => Promise<void> = async () => {};

export function registerScopeReload(fn: () => Promise<void>): void {
  _scopeReload = fn;
}

export function unregisterScopeReload(): void {
  _scopeReload = async () => {};
}

export async function triggerScopeReload(): Promise<void> {
  await _scopeReload();
}
