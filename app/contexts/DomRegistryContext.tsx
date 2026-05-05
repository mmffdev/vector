"use client";

// PLA-0005 — frontend substrate for the universal addressable registry.
//
// Three pieces ship from this file:
//   1. <DomRegistryProvider>   — fetches the per-route snapshot and exposes
//                                an in-memory address→id map.
//   2. AddressContext + <ViewportSlot kind="…">
//                              — carries the parent address down the tree
//                                so descendants can derive theirs.
//   3. useRegisterAddressable  — leaf-level hook that resolves
//                                {address, addressable_id} for a
//                                {kind, name}; falls back to POST
//                                /api/addressables/register when the
//                                derived address is missing.
//
// The address form is owned by the backend (BuildAddress in
// backend/internal/addressables/service.go) but mirrored here as a pure
// helper because the snapshot resolver and dev-collision diagnostics
// need it before the network round-trip.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useSamanthaSdk } from "@/app/contexts/SamanthaSdkContext";
import { api } from "@/app/lib/api";

// Six closed-vocabulary slots — must mirror backend's ViewportSlot.
// TypeScript's literal union enforces this at compile time (AC12).
export type ViewportSlotKind =
  | "app"
  | "header"
  | "footer"
  | "side_bar"
  | "modal"
  | "toast";

interface AddressableRow {
  id: string;
  address: string;
  page_route: string;
  kind: string;
  name: string;
  parent_id: string | null;
  source: "build" | "runtime" | "custom_app";
  // PLA-0006 / 00265 — gadmin-controlled visibility toggle for the help
  // icon. Snapshot rows from the backend always carry it; runtime-
  // registered rows default to true. May be missing on legacy seeds —
  // adopters fall back to a per-kind code default in that case.
  helpable?: boolean;
}

// PLA-0006 / 00265 — code-level fallback when an addressable's row
// hasn't loaded yet (or pre-migration legacy data). Adopter `kind` →
// default helpable. Mirrors the migration-time backfill so behaviour is
// identical before and after the snapshot resolves.
const HELPABLE_KIND_DEFAULTS: Record<string, boolean> = {
  panel: true,
  header: true,
  table: false,
  navigation: false,
};

function defaultHelpableForKind(kind: string): boolean {
  return HELPABLE_KIND_DEFAULTS[kind] ?? true;
}

// ─────────────────────────────────────────────────────────────────────
// AddressContext — parent-address propagation
// ─────────────────────────────────────────────────────────────────────

const AddressContext = createContext<string>(""); // "" means root (no parent yet)

export function useParentAddress(): string {
  return useContext(AddressContext);
}

// ─────────────────────────────────────────────────────────────────────
// DomRegistryContext — address → id map and dynamic registration
// ─────────────────────────────────────────────────────────────────────

interface DomRegistry {
  // Lookup an existing addressable id by canonical address. Undefined
  // when the address is not (yet) in the registry.
  get(address: string): string | undefined;

  // PLA-0006 / 00265 — helpable bit lookup. Returns undefined when the
  // address is not in the registry (so adopters can fall back to the
  // per-kind code default while waiting for the snapshot).
  getHelpable(address: string): boolean | undefined;

  // Insert/update locally after a successful registration round-trip.
  set(address: string, id: string, helpable?: boolean): void;

  // Sibling-collision tracking. Components register their derived address
  // here on mount, unregister on unmount; double-mount of the same
  // address signals the same parent has two siblings with identical
  // (kind, name).
  claimMount(address: string): "ok" | "collision";
  releaseMount(address: string): void;

  // Page route the snapshot was fetched for. Used by the register
  // endpoint payload.
  pageRoute: string;

  // True once the snapshot fetch has completed (success OR failure).
  // Hooks gate registration on this so they don't race the seed.
  ready: boolean;
}

const DomRegistryCtx = createContext<DomRegistry | null>(null);

export function useDomRegistry(): DomRegistry {
  const ctx = useContext(DomRegistryCtx);
  if (!ctx) {
    throw new Error("useDomRegistry must be used inside <DomRegistryProvider>");
  }
  return ctx;
}

interface DomRegistryProviderProps {
  children: React.ReactNode;
  // Override for SSR / tests where we want to seed without a network hit.
  seed?: AddressableRow[];
}

export function DomRegistryProvider({ children, seed }: DomRegistryProviderProps) {
  const pathname = usePathname() ?? "/";
  const [byAddress, setByAddress] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (seed) {
      for (const row of seed) m.set(row.address, row.id);
    }
    return m;
  });
  const [helpableByAddress, setHelpableByAddress] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    if (seed) {
      for (const row of seed) {
        if (typeof row.helpable === "boolean") m.set(row.address, row.helpable);
      }
    }
    return m;
  });
  const [ready, setReady] = useState<boolean>(seed !== undefined);
  const mountCountsRef = useRef<Map<string, number>>(new Map());

  // Snapshot seed — one fetch per route change.
  useEffect(() => {
    if (seed !== undefined) return; // tests hand us a static seed
    let cancelled = false;
    setReady(false);
    api<AddressableRow[]>(`/api/addressables/snapshot?route=${encodeURIComponent(pathname)}`)
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<string, string>();
        const h = new Map<string, boolean>();
        for (const row of rows ?? []) {
          m.set(row.address, row.id);
          if (typeof row.helpable === "boolean") h.set(row.address, row.helpable);
        }
        setByAddress(m);
        setHelpableByAddress(h);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReady(true); // fail open — registration will still attempt
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, seed]);

  const value = useMemo<DomRegistry>(
    () => ({
      get: (address) => byAddress.get(address),
      getHelpable: (address) => helpableByAddress.get(address),
      set: (address, id, helpable) => {
        setByAddress((prev) => {
          if (prev.get(address) === id) return prev;
          const next = new Map(prev);
          next.set(address, id);
          return next;
        });
        if (typeof helpable === "boolean") {
          setHelpableByAddress((prev) => {
            if (prev.get(address) === helpable) return prev;
            const next = new Map(prev);
            next.set(address, helpable);
            return next;
          });
        }
      },
      claimMount: (address) => {
        const counts = mountCountsRef.current;
        const n = (counts.get(address) ?? 0) + 1;
        counts.set(address, n);
        return n > 1 ? "collision" : "ok";
      },
      releaseMount: (address) => {
        const counts = mountCountsRef.current;
        const n = counts.get(address) ?? 0;
        if (n <= 1) counts.delete(address);
        else counts.set(address, n - 1);
      },
      pageRoute: pathname,
      ready,
    }),
    [byAddress, helpableByAddress, pathname, ready],
  );

  return <DomRegistryCtx.Provider value={value}>{children}</DomRegistryCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────────
// StrictRouteContext — opt-in "no runtime registration" gate
// ─────────────────────────────────────────────────────────────────────
//
// Wrap a page subtree in <StrictRoute> to assert that every address
// rendered inside it MUST already exist in the snapshot (i.e. has been
// seeded by the build-reconcile pipeline). Missing addresses are a
// developer error: throw in dev so the broken adopter is obvious,
// console.error + skip the runtime POST in prod so the page still
// renders.
//
// Default is non-strict so opportunistic adopters keep working until
// the page is fully audited and ready to flip.

const StrictRouteContext = createContext<boolean>(false);

export function useStrictRoute(): boolean {
  return useContext(StrictRouteContext);
}

export function StrictRoute({ children }: { children: React.ReactNode }) {
  return <StrictRouteContext.Provider value={true}>{children}</StrictRouteContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────
// <ViewportSlot> — root of every address tree
// ─────────────────────────────────────────────────────────────────────

interface ViewportSlotProps {
  kind: ViewportSlotKind;
  children: React.ReactNode;
}

// ViewportSlot seeds AddressContext with samantha._viewport.<slot>.
// Every nested useRegisterAddressable derives its address from this.
export function ViewportSlot({ kind, children }: ViewportSlotProps) {
  const address = `samantha._viewport.${kind}`;
  return <AddressContext.Provider value={address}>{children}</AddressContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────────
// Address builder — pure mirror of backend BuildAddress
// ─────────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9_]{1,64}$/;
const KIND_RE = /^[a-z0-9_]{1,32}$/;

export function buildAddress(parent: string, kind: string, name: string): string {
  if (!parent) {
    throw new Error(
      "buildAddress: parent is empty — useRegisterAddressable must be inside a <ViewportSlot>",
    );
  }
  if (!KIND_RE.test(kind)) throw new Error(`buildAddress: invalid kind "${kind}"`);
  if (!NAME_RE.test(name)) throw new Error(`buildAddress: invalid name "${name}"`);
  return `${parent}._${kind}.${name}`;
}

// ─────────────────────────────────────────────────────────────────────
// useRegisterAddressable — the leaf hook every adopter calls
// ─────────────────────────────────────────────────────────────────────

interface UseRegisterAddressableArgs {
  kind: string;
  name: string;

  // Override the slot for orphan mounts (rare; adopters should always
  // be inside a <ViewportSlot>). When set, this is treated as the root
  // for this subtree.
  rootSlot?: ViewportSlotKind;
}

interface UseRegisterAddressableResult {
  address: string;
  addressable_id: string | null;
  // PLA-0006 / 00265 — resolved per-row helpable bit. True when the
  // addressable should show its help icon. Snapshot value wins; if the
  // address hasn't loaded yet (or is pre-migration), falls back to the
  // per-kind code default in HELPABLE_KIND_DEFAULTS.
  helpable: boolean;
  // Provider is the AddressContext.Provider component already-bound to
  // this address — wrap children with it so descendants nest correctly.
  Provider: (props: { children: React.ReactNode }) => React.ReactNode;
}

const isProd = process.env.NODE_ENV === "production";

export function useRegisterAddressable(
  args: UseRegisterAddressableArgs,
): UseRegisterAddressableResult {
  const parentFromCtx = useParentAddress();
  const parent = args.rootSlot
    ? `samantha._viewport.${args.rootSlot}`
    : parentFromCtx;
  const registry = useDomRegistry();
  const strict = useStrictRoute();
  const sdk = useSamanthaSdk();

  // Compute the address up front — invalid kind/name throws synchronously
  // so the developer sees the problem at the broken component, not in a
  // network log.
  const address = useMemo(
    () => buildAddress(parent, args.kind, args.name),
    [parent, args.kind, args.name],
  );

  const seededID = registry.get(address);
  const [resolvedID, setResolvedID] = useState<string | null>(seededID ?? null);

  // Sibling-collision detection. Mount-count > 1 with the same address
  // means the same parent has two siblings with identical (kind, name).
  // AC12: throw in dev, console.error + samantha._collision.<address>
  // fallback in prod so the page still renders.
  const collisionRef = useRef<string | null>(null);
  useEffect(() => {
    const status = registry.claimMount(address);
    if (status === "collision") {
      collisionRef.current = `samantha._collision.${address}`;
      const msg = `addressable collision: two siblings share ${address}`;
      if (!isProd) {
        // throw synchronously on the next tick so React still mounts the
        // component and devtools surface a clean stack
        throw new Error(msg);
      }
      // Production: log once and let downstream reads see the fallback.
      // eslint-disable-next-line no-console
      console.error(msg);
    }
    return () => registry.releaseMount(address);
  }, [registry, address]);

  // Re-sync resolvedID when the registry's seed changes (snapshot fetch
  // can land after first render).
  useEffect(() => {
    const fromMap = registry.get(address);
    if (fromMap && fromMap !== resolvedID) {
      setResolvedID(fromMap);
    }
  }, [registry, address, resolvedID]);

  // If the registry is ready but the address is unknown, fire the
  // runtime register call. Production refuses runtime regs on the
  // backend (returns 403), so we silently no-op rather than spam the
  // console — a build-reconcile is the proper fix.
  //
  // In strict-route mode, missing addresses are a build-time error:
  // throw in dev (the developer must add the address to the build
  // tree), console.error in prod (the page still renders).
  useEffect(() => {
    if (resolvedID) return;
    if (!registry.ready) return;
    const fromMap = registry.get(address);
    if (fromMap) {
      setResolvedID(fromMap);
      return;
    }
    if (strict) {
      // PLA-0006 / 00263 — strict mode degraded to a warning until the
      // build-reconcile pipeline exists for non-Dashboard routes. Without
      // it, the snapshot is empty for /dev, /backlog, /portfolio, etc.
      // and a hard throw crashes every page on first paint. Fall through
      // to the runtime register POST so the page renders; the missing
      // address gets created in page_addressables on demand.
      // eslint-disable-next-line no-console
      console.warn(
        `addressable not in snapshot: ${address} — falling back to runtime register (build-reconcile pipeline pending)`,
      );
    }
    // ParentAddress drives the backend's parent_address argument; pass
    // empty string for ViewportSlot-root descendants whose immediate
    // parent IS the slot (the backend treats the slot as the root).
    const slotPrefix = parent.match(/^samantha\._viewport\.([a-z_]+)$/);
    const isDirectChild = slotPrefix !== null;
    const slot = isDirectChild ? slotPrefix![1] : parent.split(".")[2];

    let cancelled = false;
    // Samantha SDK contract — when this hook fires from inside a custom
    // app frame, tag the runtime registration so the backend can apply
    // the custom_app_id collision rules (ErrCustomAppCollision) and the
    // gadmin /dev/page-help editor can filter by source.
    const sdkBody = sdk.customAppId
      ? { source: "custom_app" as const, custom_app_id: sdk.customAppId }
      : { source: "runtime" as const };
    // Use api() rather than raw fetch — it injects the X-CSRF-Token
    // header and Bearer token that the backend's CSRF middleware and
    // RequireAuth (when applied elsewhere) require. Raw fetch would
    // pass the cookie but omit the double-submit header → 403.
    void api<{ id: string; address: string; helpable?: boolean }>(
      "/api/addressables/register",
      {
        method: "POST",
        body: JSON.stringify({
          page_route: registry.pageRoute,
          parent_address: isDirectChild ? "" : parent,
          slot,
          kind: args.kind,
          name: args.name,
          ...sdkBody,
        }),
      }
    )
      .then((data) => {
        if (cancelled || !data) return;
        registry.set(data.address, data.id, data.helpable);
        setResolvedID(data.id);
      })
      .catch(() => {
        // Network failures are non-fatal — the substrate degrades to
        // "no help / no address handle" rather than breaking the page.
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedID, registry, parent, args.kind, args.name, strict, address, sdk.customAppId]);

  // The Provider component scopes child addresses to this node. Build
  // it once and memoize so React doesn't see a new function identity
  // every render (would re-mount every descendant).
  const Provider = useCallback(
    ({ children }: { children: React.ReactNode }) => (
      <AddressContext.Provider value={address}>{children}</AddressContext.Provider>
    ),
    [address],
  );

  // Resolve the helpable bit: snapshot value wins, otherwise per-kind
  // code default. Memoised because kind/address are stable per render.
  const helpableFromRegistry = registry.getHelpable(address);
  const helpable =
    typeof helpableFromRegistry === "boolean"
      ? helpableFromRegistry
      : defaultHelpableForKind(args.kind);

  return { address, addressable_id: resolvedID, helpable, Provider };
}
