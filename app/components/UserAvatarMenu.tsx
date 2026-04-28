"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs, type NavCatalogEntry } from "@/app/contexts/NavPrefsContext";
import { useThemePack, type ThemePack } from "@/app/hooks/useThemePack";

interface PaletteOption {
  id: ThemePack;
  label: string;
  swatches: [string, string, string, string];
}

const PALETTES: PaletteOption[] = [
  { id: "default",        label: "Default",        swatches: ["#FFFFFF", "#EDEAE4", "#1A1A1A", "#E5E1DA"] },
  { id: "vector-mono",    label: "Vector Mono",    swatches: ["#FF346E", "#000000", "#C9CACF", "#ACAFBA"] },
  { id: "charcoal-amber", label: "Charcoal Amber", swatches: ["#E8A437", "#ECE2C8", "#2A2C2E", "#000000"] },
  { id: "vector-marine",  label: "Vector Marine",  swatches: ["#B3F938", "#082429", "#ECD5C5", "#CED9D9"] },
  { id: "atlas",          label: "Atlas",          swatches: ["#5FA547", "#1F3D8E", "#FFFFFF", "#D6D8DA"] },
  { id: "coral-tide",     label: "Coral Tide",     swatches: ["#FF6A5B", "#064A60", "#EAEAEA", "#CDCDCD"] },
  { id: "slate",          label: "Slate",          swatches: ["#2C3E50", "#778899", "#DFE3EE", "#A2B9BC"] },
  { id: "harbor",         label: "Harbor",         swatches: ["#DD6A3C", "#26333E", "#F2EAD6", "#D3CEBF"] },
  { id: "dusk-mauve",     label: "Dusk Mauve",     swatches: ["#B080B4", "#161A2F", "#DDC8D8", "#9AB0D0"] },
  { id: "sea-glass",      label: "Sea Glass",      swatches: ["#99CDD8", "#475048", "#DAEBE3", "#CFD6C4"] },
  { id: "vesper",         label: "Vesper",         swatches: ["#EB9F5A", "#1D0A39", "#DBBCB9", "#C4A7AA"] },
  { id: "dusk-slate",     label: "Dusk Slate",     swatches: ["#5C707A", "#181D23", "#DCDCDC", "#A89DAB"] },
  { id: "sundown",        label: "Sundown",        swatches: ["#E1762E", "#10314A", "#A6CDD8", "#88AEBC"] },
  { id: "vector-bloom",   label: "Vector Bloom",   swatches: ["#C9495F", "#2E3340", "#F5F0E8", "#EDE7EC"] },
  { id: "tideline",       label: "Tideline",       swatches: ["#EE9763", "#080807", "#CDEDF7", "#6F7C72"] },
  { id: "sorbet",         label: "Sorbet",         swatches: ["#E89236", "#1A1A1A", "#FFFFFF", "#F0D5DA"] },
  { id: "mesa",           label: "Mesa",           swatches: ["#C5764A", "#5C2A1B", "#DDDDD8", "#A6B0BC"] },
  { id: "oyster",         label: "Oyster",         swatches: ["#7C746C", "#2D3540", "#F2EEE8", "#D2D5D8"] },
  { id: "kelp",           label: "Kelp",           swatches: ["#5BC4BD", "#1A3D54", "#A6E891", "#7DDBA8"] },
  { id: "linen",          label: "Linen",          swatches: ["#B8B5B0", "#2A2925", "#EDECE9", "#D5D7DB"] },
  { id: "meadow-pop",     label: "Meadow Pop",     swatches: ["#D85072", "#1B313D", "#BFE0BC", "#ABCBAD"] },
  { id: "cobalt-lime",    label: "Cobalt Lime",    swatches: ["#D0F040", "#080810", "#080810", "#161C35"] },
  { id: "cobalt-day",     label: "Cobalt Day",     swatches: ["#D0F040", "#0A0C14", "#EEF4FA", "#C8DFF0"] },
  { id: "abyss",          label: "Abyss",          swatches: ["#4A8FA8", "#0A1A2F", "#0A1A2F", "#143352"] },
  { id: "tidal-amber",    label: "Tidal Amber",    swatches: ["#C87840", "#0A1A2F", "#0A1A2F", "#143352"] },
  { id: "taupe-navy",     label: "Taupe Navy",     swatches: ["#B0A090", "#2B3A4A", "#2B3A4A", "#374858"] },
  { id: "chalk-navy",     label: "Chalk Navy",     swatches: ["#2B3A4A", "#2B3A4A", "#F0EBE0", "#DDD8CE"] },
  { id: "buckthorn",      label: "Buckthorn",      swatches: ["#A67B5B", "#002850", "#002850", "#003A6B"] },
  { id: "moonlit",        label: "Moonlit",        swatches: ["#A67B5B", "#002850", "#F0F0F8", "#E0E0EC"] },
  { id: "nightberry",     label: "Nightberry",     swatches: ["#FC5A8D", "#1A1A1A", "#1A1A1A", "#2A1E22"] },
  { id: "berry-dawn",     label: "Berry Dawn",     swatches: ["#FC5A8D", "#3C1A2A", "#F8F0F4", "#EDD8E2"] },
  { id: "ember-wine",     label: "Ember Wine",     swatches: ["#C1440E", "#3A0008", "#3A0008", "#5E0010"] },
  { id: "saffron-tide",   label: "Saffron Tide",   swatches: ["#F4C430", "#1E1A26", "#F2EEE3", "#E2DCCC"] },
  { id: "spectrum",       label: "Spectrum",       swatches: ["#E07030", "#1A2B4A", "#F0E8D0", "#DDD0B0"] },
  { id: "spectrum-dusk",  label: "Spectrum Dusk",  swatches: ["#E07030", "#1A2B4A", "#1A2B4A", "#243760"] },
  { id: "stratum",        label: "Stratum",        swatches: ["#E06050", "#2D3035", "#2D3035", "#3A4048"] },
  { id: "coral-chalk",    label: "Coral Chalk",    swatches: ["#E06050", "#1E2025", "#EBE5D8", "#D8D0C2"] },
  { id: "oslo",           label: "Oslo",           swatches: ["#4C8EA0", "#0D2137", "#0D2137", "#153048"] },
  { id: "blush-steel",    label: "Blush Steel",    swatches: ["#D89060", "#1A2A3A", "#F5EBE8", "#E8D5D0"] },
  { id: "maritime",       label: "Maritime",       swatches: ["#E06020", "#1A2B4A", "#1A2B4A", "#243760"] },
  { id: "aurora",         label: "Aurora",         swatches: ["#8090D0", "#1A2060", "#EAF8D8", "#C8F0A0"] },
  { id: "ironworks",      label: "Ironworks",      swatches: ["#C87820", "#1A1C1E", "#1A1C1E", "#252830"] },
  { id: "rosewood",       label: "Rosewood",       swatches: ["#6B2737", "#2A1018", "#F5EEF0", "#E8D4D8"] },
];

function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="7.5"  cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12"   cy="7"  r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Icon({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2"  y="2"  width="9" height="9" fill="var(--theme-icon-tl, #e53935)" />
      <rect x="13" y="2"  width="9" height="9" fill="var(--theme-icon-tr, #1e88e5)" />
      <rect x="2"  y="13" width="9" height="9" fill="var(--theme-icon-bl, #fdd835)" />
      <rect x="13" y="13" width="9" height="9" fill="var(--theme-icon-br, #43a047)" />
    </svg>
  );
}

function IconFor({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "home":      return <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "briefcase": return <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />;
    case "cog":       return <Icon d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    case "wrench":    return <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    case "theme":     return <ThemeIcon />;
    default:          return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />;
  }
}

function LogoutIcon() {
  return (
    <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" d2="M16 17l5-5-5-5M21 12H9" />
  );
}

export default function UserAvatarMenu() {
  const { user, logout } = useAuth();
  const { catalogue, tags } = useNavPrefs();
  const { pack, choose, mounted: paletteMounted, saveError: themeSaveError, clearSaveError: clearThemeSaveError } = useThemePack();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Group pages whose tag is flagged is_admin_menu, role-filtered by the
  // server's catalogue. The `admin_settings` tag (Workspace/Portfolio
  // Settings) lives in the header cog dropdown — exclude it here.
  const groupedAdminPages = useMemo(() => {
    const adminTagEnums = new Set(
      tags.filter((t) => t.isAdminMenu && t.enum !== "admin_settings").map((t) => t.enum),
    );
    const byTag = new Map<string, NavCatalogEntry[]>();
    for (const entry of catalogue) {
      if (!adminTagEnums.has(entry.tagEnum)) continue;
      const list = byTag.get(entry.tagEnum) ?? [];
      list.push(entry);
      byTag.set(entry.tagEnum, list);
    }
    const orderedTags = tags
      .filter((t) => t.isAdminMenu && t.enum !== "admin_settings" && byTag.has(t.enum))
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    return orderedTags.map((tag) => ({
      tag,
      items: (byTag.get(tag.enum) ?? []).slice().sort((a, b) => a.defaultOrder - b.defaultOrder),
    }));
  }, [catalogue, tags]);

  useEffect(() => {
    if (!open) {
      setPaletteOpen(false);
      return;
    }
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="avatar-menu" ref={rootRef}>
      <button
        type="button"
        className="app-header-wrapper__avatar"
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initials}
      </button>
      {open && (
        <div className="avatar-menu__panel" role="menu" aria-label="Account menu">
          <div className="avatar-menu__header">
            <div className="avatar-menu__email">{user.email}</div>
            <div className="avatar-menu__role">{user.role}</div>
          </div>
          {groupedAdminPages.map(({ tag, items }) => (
            <div key={tag.enum} className="avatar-menu__group">
              <div className="avatar-menu__group-heading">{tag.label}</div>
              {items.map((entry) => (
                <Link
                  key={entry.key}
                  href={entry.href}
                  className="sidebar-item avatar-menu__item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <IconFor iconKey={entry.icon} />
                  <span className="sidebar-item__label">{entry.label}</span>
                </Link>
              ))}
            </div>
          ))}
          <div
            className="avatar-menu__group avatar-menu__palette-group"
            onMouseEnter={() => {
              clearThemeSaveError();
              setPaletteOpen(true);
            }}
            // Keep the flyout open if a save just failed so the user
            // sees the inline alert; otherwise mouse-leave closes it.
            onMouseLeave={() => {
              if (!themeSaveError) setPaletteOpen(false);
            }}
          >
            <button
              type="button"
              className="sidebar-item avatar-menu__item avatar-menu__palette-trigger"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={paletteOpen}
              onFocus={() => setPaletteOpen(true)}
              onClick={() => setPaletteOpen((v) => !v)}
            >
              <PaletteIcon />
              <span className="sidebar-item__label">Palette</span>
              <span className="avatar-menu__chev" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </span>
            </button>
            {paletteOpen && (
              <div className="avatar-menu__flyout" role="menu" aria-label="Palette themes">
                <div className="avatar-menu__flyout-heading">Palette</div>
                <div className="avatar-menu__flyout-grid">
                  {PALETTES.map((p) => {
                    const active = paletteMounted && pack === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={`palette-card${active ? " palette-card--active" : ""}`}
                        onClick={async () => {
                          const ok = await choose(p.id);
                          if (ok) {
                            setPaletteOpen(false);
                            setOpen(false);
                          }
                        }}
                      >
                        <span className="palette-card__swatches" aria-hidden="true">
                          {p.swatches.map((c, i) => (
                            <span
                              key={i}
                              className="palette-card__swatch"
                              style={{ background: c }}
                            />
                          ))}
                        </span>
                        <span className="palette-card__label">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
                {themeSaveError && (
                  <div className="avatar-menu__flyout-error" role="alert" aria-live="polite">
                    {themeSaveError}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="avatar-menu__group avatar-menu__group--footer">
            <button
              type="button"
              className="sidebar-item sidebar-item--button avatar-menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              <LogoutIcon />
              <span className="sidebar-item__label">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
