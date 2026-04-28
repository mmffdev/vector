"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/app/lib/api";

export type ThemePack = "default" | "vector-mono" | "charcoal-amber" | "vector-marine" | "atlas" | "coral-tide" | "slate" | "harbor" | "dusk-mauve" | "sea-glass" | "vesper" | "dusk-slate" | "sundown" | "vector-bloom" | "tideline" | "sorbet" | "kelp" | "linen" | "mesa" | "oyster" | "meadow-pop" | "cobalt-lime" | "cobalt-day" | "abyss" | "tidal-amber" | "taupe-navy" | "chalk-navy" | "buckthorn" | "moonlit" | "nightberry" | "berry-dawn" | "ember-wine" | "saffron-tide" | "spectrum" | "spectrum-dusk" | "stratum" | "coral-chalk" | "oslo" | "blush-steel" | "maritime" | "aurora" | "ironworks" | "rosewood";

const STORAGE_KEY = "vector-theme-pack";
const LINK_ID = "vector-theme-pack";

const PACK_HREF: Record<Exclude<ThemePack, "default">, string> = {
  "vector-mono": "/themes/vector-mono.css",
  "charcoal-amber": "/themes/charcoal-amber.css",
  "vector-marine": "/themes/vector-marine.css",
  "atlas": "/themes/atlas.css",
  "coral-tide": "/themes/coral-tide.css",
  "slate": "/themes/slate.css",
  "harbor": "/themes/harbor.css",
  "dusk-mauve": "/themes/dusk-mauve.css",
  "sea-glass": "/themes/sea-glass.css",
  "vesper": "/themes/vesper.css",
  "dusk-slate": "/themes/dusk-slate.css",
  "sundown": "/themes/sundown.css",
  "vector-bloom": "/themes/vector-bloom.css",
  "tideline": "/themes/tideline.css",
  "sorbet": "/themes/sorbet.css",
  "kelp": "/themes/kelp.css",
  "linen": "/themes/linen.css",
  "mesa": "/themes/mesa.css",
  "oyster": "/themes/oyster.css",
  "meadow-pop": "/themes/meadow-pop.css",
  "cobalt-lime": "/themes/cobalt-lime.css",
  "cobalt-day": "/themes/cobalt-day.css",
  "abyss": "/themes/abyss.css",
  "tidal-amber": "/themes/tidal-amber.css",
  "taupe-navy": "/themes/taupe-navy.css",
  "chalk-navy": "/themes/chalk-navy.css",
  "buckthorn": "/themes/buckthorn.css",
  "moonlit": "/themes/moonlit.css",
  "nightberry": "/themes/nightberry.css",
  "berry-dawn": "/themes/berry-dawn.css",
  "ember-wine": "/themes/ember-wine.css",
  "saffron-tide": "/themes/saffron-tide.css",
  "spectrum": "/themes/spectrum.css",
  "spectrum-dusk": "/themes/spectrum-dusk.css",
  "stratum": "/themes/stratum.css",
  "coral-chalk": "/themes/coral-chalk.css",
  "oslo": "/themes/oslo.css",
  "blush-steel": "/themes/blush-steel.css",
  "maritime": "/themes/maritime.css",
  "aurora": "/themes/aurora.css",
  "ironworks": "/themes/ironworks.css",
  "rosewood": "/themes/rosewood.css",
};

const VALID_PACKS: ThemePack[] = ["default", "vector-mono", "charcoal-amber", "vector-marine", "atlas", "coral-tide", "slate", "harbor", "dusk-mauve", "sea-glass", "vesper", "dusk-slate", "sundown", "vector-bloom", "tideline", "sorbet", "kelp", "linen", "mesa", "oyster", "meadow-pop", "cobalt-lime", "cobalt-day", "abyss", "tidal-amber", "taupe-navy", "chalk-navy", "buckthorn", "moonlit", "nightberry", "berry-dawn", "ember-wine", "saffron-tide", "spectrum", "spectrum-dusk", "stratum", "coral-chalk", "oslo", "blush-steel", "maritime", "aurora", "ironworks", "rosewood"];

function isValidPack(v: unknown): v is ThemePack {
  return typeof v === "string" && (VALID_PACKS as string[]).includes(v);
}

function applyPack(pack: ThemePack) {
  const existing = document.getElementById(LINK_ID);
  if (pack === "default") {
    existing?.remove();
    return;
  }
  const href = PACK_HREF[pack];
  if (!href) return;
  if (existing && existing.getAttribute("href") === href) return;
  existing?.remove();
  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

interface ServerThemePack {
  pack: string;
}

export function useThemePack() {
  const [pack, setPack] = useState<ThemePack>("default");
  const [mounted, setMounted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // First paint: trust localStorage so the user never flashes the
    // wrong palette on page load (server round-trip would lag a frame).
    const cached = localStorage.getItem(STORAGE_KEY);
    const local: ThemePack = isValidPack(cached) ? cached : "default";
    setPack(local);
    applyPack(local);
    setMounted(true);

    // Then reconcile with the server — auth context owns the access
    // token, so this may 401 if the user isn't logged in (login page,
    // password-reset, etc.). Swallow that quietly; the local cache
    // remains authoritative until the user authenticates and the
    // hook is re-mounted.
    let cancelled = false;
    (async () => {
      try {
        const r = await api<ServerThemePack>("/api/me/theme-pack");
        if (cancelled) return;
        const remote: ThemePack = isValidPack(r.pack) ? r.pack : "default";
        if (remote !== local) {
          setPack(remote);
          applyPack(remote);
          localStorage.setItem(STORAGE_KEY, remote);
        }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return;
        }
        // Network/server failure — keep the cached pack; nothing to do.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply optimistically, then persist. Returns true on success so
  // callers can decide whether to close a menu / dismiss UI; on
  // failure (other than 401/403, which are silent) `saveError` is
  // populated for callers to surface inline. Auth failures stay
  // silent because they are already handled by the auth flow.
  const choose = async (next: ThemePack): Promise<boolean> => {
    setPack(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyPack(next);
    setSaveError(null);

    try {
      await api("/api/me/theme-pack", {
        method: "PUT",
        body: JSON.stringify({ pack: next }),
      });
      return true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      setSaveError("Could not save theme to your profile. The change is local until the next successful save.");
      return false;
    }
  };

  const clearSaveError = () => setSaveError(null);

  return { pack, choose, mounted, saveError, clearSaveError };
}
