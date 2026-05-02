"use client";

// PLA-0006 / 00266 — Address-anchor resolver.
//
// Mounted once at the root layout. Watches `location.hash` for an
// addressable share-link of the form `#addr=samantha._viewport.app._panel.foo`.
// When seen, finds the first DOM element with `data-address="<value>"`,
// scrolls it into view, and applies the `.is-anchor-target` highlight
// class for 1500ms so the user can spot which element was deep-linked.
//
// The resolver retries for ~2.5s after each hash change because the
// snapshot fetch + adopter mounts can land after the URL is processed.
// If the address never appears, the resolver silently gives up — no
// console noise, no UI for missing targets (the page still works).

import { useEffect } from "react";

const ANCHOR_PREFIX = "#addr=";
const HIGHLIGHT_CLASS = "is-anchor-target";
const HIGHLIGHT_MS = 1500;
// Snapshot fetch + adopter mount can land 100–800ms after first paint;
// poll for up to 2.5s before giving up.
const RESOLVE_DEADLINE_MS = 2500;
const POLL_INTERVAL_MS = 80;

function parseAnchor(hash: string): string | null {
  if (!hash.startsWith(ANCHOR_PREFIX)) return null;
  const raw = hash.slice(ANCHOR_PREFIX.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function findElementForAddress(address: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-address="${CSS.escape(address)}"]`);
}

export default function AddressAnchorResolver() {
  useEffect(() => {
    let cancelled = false;
    let highlightTimer: number | null = null;
    let pollTimer: number | null = null;

    const clearHighlight = (el: HTMLElement) => {
      el.classList.remove(HIGHLIGHT_CLASS);
    };

    const resolve = (address: string) => {
      const deadline = performance.now() + RESOLVE_DEADLINE_MS;

      const tick = () => {
        if (cancelled) return;
        const el = findElementForAddress(address);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add(HIGHLIGHT_CLASS);
          if (highlightTimer !== null) window.clearTimeout(highlightTimer);
          highlightTimer = window.setTimeout(() => clearHighlight(el), HIGHLIGHT_MS);
          return;
        }
        if (performance.now() >= deadline) return;
        pollTimer = window.setTimeout(tick, POLL_INTERVAL_MS);
      };

      tick();
    };

    const onHashChange = () => {
      const address = parseAnchor(window.location.hash);
      if (!address) return;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      resolve(address);
    };

    onHashChange(); // initial — handle direct deep-link load
    window.addEventListener("hashchange", onHashChange);

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
      if (highlightTimer !== null) window.clearTimeout(highlightTimer);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, []);

  return null;
}
