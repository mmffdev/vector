/**
 * Sentinel — public surface barrel.
 *
 * Consumers should import from `@/app/sentinel` only — never from
 * the per-file paths. The barrel pins what's public:
 *   - `SentinelProvider` — mount once at the top of every layout
 *     that contains protected pages (PLA062 S09).
 *   - `useSentinel()` — the hook that returns the full sentinel_*
 *     state bag. Throws if used outside the provider.
 *   - Types: `SentinelState`, `SentinelUser`, `SentinelTenant`,
 *     `SentinelGrant`, `SentinelPermission`.
 *
 * Implementation files (SentinelCtx context handle, sentinel_api HTTP
 * helpers) are deliberately NOT re-exported — internal coupling.
 */

export { SentinelProvider } from "./SentinelProvider";
export { useSentinel } from "./useSentinel";
export type {
  SentinelState,
  SentinelUser,
  SentinelTenant,
  SentinelGrant,
  SentinelPermission,
  SentinelWorkspaceSettings,
} from "./types";
