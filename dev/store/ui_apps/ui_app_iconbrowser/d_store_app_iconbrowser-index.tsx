"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import "./d_store_app_iconbrowser.css";

// ── react-icons sub-packs ─────────────────────────────────────────────────────
import * as RiFa from "react-icons/fa6";   // Font Awesome 6
import * as RiMd from "react-icons/md";    // Material Design
import * as RiBs from "react-icons/bs";    // Bootstrap Icons
import * as RiTb from "react-icons/tb";    // Tabler Icons
import * as RiRi from "react-icons/ri";    // Remix Icons

// ── Types ──────────────────────────────────────────────────────────────────────
type IconEntry = { name: string; Component: React.ComponentType<{ size?: number; className?: string }> };

// ── Helpers ───────────────────────────────────────────────────────────────────
function isRenderableComponent(v: unknown): boolean {
  if (typeof v === "function") return true;
  // forwardRef / memo wrappers are objects with $$typeof
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.$$typeof) return true;
    if (typeof o.render === "function") return true;
  }
  return false;
}

function toEntries(
  mod: Record<string, unknown>,
  exclude: string[] = []
): IconEntry[] {
  return Object.entries(mod)
    .filter(([k, v]) => !exclude.includes(k) && isRenderableComponent(v))
    .map(([k, v]) => ({ name: k, Component: v as IconEntry["Component"] }));
}

const PACKS: { id: string; label: string; entries: IconEntry[] }[] = [
  {
    id: "fa6",
    label: "Font Awesome 6",
    entries: toEntries(RiFa as Record<string, unknown>),
  },
  {
    id: "md",
    label: "Material Design",
    entries: toEntries(RiMd as Record<string, unknown>),
  },
  {
    id: "bs",
    label: "Bootstrap",
    entries: toEntries(RiBs as Record<string, unknown>),
  },
  {
    id: "tabler",
    label: "Tabler",
    entries: toEntries(RiTb as Record<string, unknown>),
  },
  {
    id: "remix",
    label: "Remix",
    entries: toEntries(RiRi as Record<string, unknown>),
  },
];

// ── Icon Item ─────────────────────────────────────────────────────────────────
function IconItem({ entry, packId, onCopy }: {
  entry: IconEntry;
  packId: string;
  onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    const text = `${packId}:${entry.name}`;
    navigator.clipboard.writeText(text).catch(() => {});
    onCopy(entry.name);
    setCopied(true);
    setTimeout(() => setCopied(false), 800);
  }, [entry.name, packId, onCopy]);

  return (
    <button
      type="button"
      className={"icon-browser__item" + (copied ? " icon-browser__item--copied" : "")}
      onClick={handleClick}
      title={entry.name}
    >
      <span className="icon-browser__icon">
        <entry.Component size={20} />
      </span>
      <span className="icon-browser__name">{entry.name}</span>
    </button>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function UiAppIconbrowser() {
  const [activeTab, setActiveTab] = useState("fa6");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const pack = PACKS.find((p) => p.id === activeTab) ?? PACKS[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pack.entries;
    return pack.entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [pack, search]);

  const handleCopy = useCallback((name: string) => {
    setToast(`Copied: ${name}`);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="icon-browser">
      {/* Toolbar */}
      <div className="icon-browser__toolbar">
        <input
          type="search"
          className="form__input icon-browser__search"
          placeholder="Search icons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="icon-browser__count">{filtered.length} icons</span>
      </div>

      {/* Tabs */}
      <div className="icon-browser__tabs">
        {PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={"icon-browser__tab" + (activeTab === p.id ? " icon-browser__tab--active" : "")}
            onClick={() => { setActiveTab(p.id); setSearch(""); }}
          >
            {p.label} ({p.entries.length})
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="icon-browser__grid-wrap">
        <div className="icon-browser__grid">
          {filtered.length === 0 ? (
            <p className="icon-browser__empty">No icons match &ldquo;{search}&rdquo;</p>
          ) : (
            filtered.map((entry) => (
              <IconItem
                key={entry.name}
                entry={entry}
                packId={activeTab}
                onCopy={handleCopy}
              />
            ))
          )}
        </div>
      </div>

      {/* Copy toast */}
      {toast && (
        <div className="icon-browser__toast">{toast} — click to copy name</div>
      )}
    </div>
  );
}
