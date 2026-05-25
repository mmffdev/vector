"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShell, type ShellPage } from "../ShellContext";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
import { useSentinel } from "@/app/sentinel";
import type { SentinelGrant } from "@/app/sentinel/types";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import { TravelIndicator, useTravelIndicator } from "./nav_travel_indicator";
import ScopeTreePanel from "@/app/components/ScopeTreePanel";
import ScopeGroupPanel from "@/app/components/ScopeGroupPanel";

// Derive the active grant from Sentinel's grants array + focus node.
// Mirrors what ScopeContext.activeGrant exposed pre-PLA062.
function useActiveGrantFromSentinel(): { activeGrant: SentinelGrant | null; reload: () => Promise<void> } {
  const { sentinel_grants, sentinel_focus_node, sentinel_reload } = useSentinel();
  const activeGrant = sentinel_grants.find((g) => g.node_id === sentinel_focus_node) ?? null;
  return { activeGrant, reload: sentinel_reload };
}

function formatNow(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

// Dev pages live under /dev/* and intentionally do NOT show the global
// bookmark bucket — the dev tab catalogue owns its own rail-2 contents.
// Every other rail-2 surface (section, scope, account) shows the bucket
// unconditionally, even when empty (renders an empty-state hint).
export function isDevPath(pathname: string): boolean {
  return pathname === "/dev" || pathname.startsWith("/dev/");
}

export function BookmarkBucket({
  bookmarkPages,
  isActivePage,
  activeKey,
}: {
  bookmarkPages: ShellPage[];
  isActivePage: (href: string) => boolean;
  activeKey: string | null;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const { indicator, phase, setTarget } = useTravelIndicator(groupRef, activeKey, { inset: 4 });
  return (
    <div className="rail-2__bookmarks">
      <div className="rail-2__bookmarks_divider" aria-hidden />
      <span className="rail-2__bookmarks_label">Bookmarks</span>
      {bookmarkPages.length > 0 ? (
        <div className="rail-2__nav" ref={groupRef}>
          <TravelIndicator
            id="rail-2__bookmarks_travel-indicator"
            indicator={indicator}
            phase={phase}
          />
          {bookmarkPages.map((p) => (
            <PageRow key={p.itemKey} page={p} active={isActivePage(p.href)} setRef={setTarget} />
          ))}
        </div>
      ) : (
        <p className="rail-2__bookmarks_empty">No bookmarks yet</p>
      )}
    </div>
  );
}

// First-ever-load skeleton (no NavPrefs cache to hydrate from). Renders
// the same shell chrome (header band + clock) so layout is stable, with
// ghost rows where pages will appear. Cache hits skip this entirely.
function RailSkeleton({ now }: { now: Date }) {
  return (
    <aside className="rail-2" aria-label="Loading section" aria-busy="true">
      <RailHeader title={null} now={now} />
      <div className="rail-2__content">
        <div className="rail-2__top">
          <div className="rail-2__nav">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rail-2__nav-row rail-2__nav-row--skeleton" aria-hidden="true" />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function RailHeader({ title, now }: { title: string | null | undefined; now: Date }) {
  // Rail-2 title MUST show the focused topology-node name (Sentinel scope
  // label) — never the page/section title. When no node is focused (boot,
  // no grants, per-user pages like account-settings), render an empty
  // <h3> so the band keeps its height but carries no fallback text.
  return (
    <div className="rail-2__header header-band">
      <h3 className="rail-2__title">{title ?? ""}</h3>
      <p className="rail-2__date" aria-live="off">{formatNow(now)}</p>
    </div>
  );
}

export default function SectionFlyout() {
  const { activeSection, bookmarkPages } = useShell();
  const { loading: navLoading } = useNavPrefs();
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const groupRef = useRef<HTMLDivElement>(null);
  const showBookmarks = !isDevPath(pathname);

  // First-ever load (no cache): activeSection is undefined AND nav is still
  // loading. Render a skeleton instead of an empty aside so the rail reads
  // as "loading" not "missing". Cache hits skip this branch entirely.
  if (!activeSection) {
    if (navLoading) return <RailSkeleton now={now} />;
    return <aside className="rail-2" aria-label="Section" />;
  }

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Two-pass render: top-level pages (no parent) first, then nested children
  // under their parent's row. Catalogue order already ranks by position.
  const tops = activeSection.pages.filter((p) => p.parentItemKey == null);
  const childrenByParent = new Map<string, ShellPage[]>();
  for (const p of activeSection.pages) {
    if (p.parentItemKey) {
      const arr = childrenByParent.get(p.parentItemKey) ?? [];
      arr.push(p);
      childrenByParent.set(p.parentItemKey, arr);
    }
  }

  // Pick the longest-matching page so nested children win over their parent.
  // Also check bookmark pages so the indicator works there too.
  let activeKey: string | null = null;
  let bestLen = -1;
  for (const p of [...activeSection.pages, ...bookmarkPages]) {
    if (isActivePage(p.href) && p.href.length > bestLen) {
      activeKey = p.itemKey;
      bestLen = p.href.length;
    }
  }

  return (
    <SectionFlyoutBody
      activeSection={activeSection}
      tops={tops}
      childrenByParent={childrenByParent}
      bookmarkPages={bookmarkPages}
      showBookmarks={showBookmarks}
      isActivePage={isActivePage}
      activeKey={activeKey}
      groupRef={groupRef}
      now={now}
    />
  );
}

function SectionFlyoutBody({
  activeSection,
  tops,
  childrenByParent,
  bookmarkPages,
  showBookmarks,
  isActivePage,
  activeKey,
  groupRef,
  now,
}: {
  activeSection: NonNullable<ReturnType<typeof useShell>["activeSection"]>;
  tops: ShellPage[];
  childrenByParent: Map<string, ShellPage[]>;
  bookmarkPages: ShellPage[];
  showBookmarks: boolean;
  isActivePage: (href: string) => boolean;
  activeKey: string | null;
  groupRef: React.RefObject<HTMLDivElement>;
  now: Date;
}) {
  const { indicator, phase, setTarget } = useTravelIndicator(groupRef, activeKey, { inset: 4 });
  const { activeGrant } = useActiveGrantFromSentinel();
  const scopeLabel = activeGrant
    ? (activeGrant.label_override?.trim() || activeGrant.name)
    : null;

  return (
    <aside className="rail-2" aria-label={`${activeSection.name} pages`}>
      <RailHeader title={scopeLabel} now={now} />

      <div className="rail-2__content">
        <div className="rail-2__top">
          <div className="rail-2__nav" ref={groupRef}>
            <TravelIndicator id="rail-2__nav_travel-indicator" indicator={indicator} phase={phase} />
            {tops.map((p) => {
              const kids = childrenByParent.get(p.itemKey) ?? [];
              return (
                <div key={p.itemKey}>
                  <PageRow page={p} active={isActivePage(p.href)} setRef={setTarget} />
                  {kids.map((k) => (
                    <PageRow
                      key={k.itemKey}
                      page={k}
                      active={isActivePage(k.href)}
                      nested
                      setRef={setTarget}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {showBookmarks && (
            <BookmarkBucket
              bookmarkPages={bookmarkPages}
              isActivePage={isActivePage}
              activeKey={activeKey}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

/** Grouped scope panel — replaces the normal SectionFlyout when isScopeOpen=true. */
export function ScopeFlyout2() {
  const { bookmarkPages } = useShell();
  const { activeGrant, reload } = useActiveGrantFromSentinel();
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Refresh grants each time the panel opens so the list is current.
  useEffect(() => { void reload(); }, [reload]);

  const scopeLabel = activeGrant
    ? (activeGrant.label_override?.trim() || activeGrant.name)
    : null;
  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeKey = bookmarkPages.find((p) => isActivePage(p.href))?.itemKey ?? null;
  const showBookmarks = !isDevPath(pathname);

  return (
    <aside className="rail-2 rail-2--scope" aria-label="Workspace scope">
      <RailHeader title={scopeLabel} now={now} />
      <div className="rail-2__content rail-2__content--scope vector-scroll">
        <ScopeGroupPanel />
        {showBookmarks && (
          <BookmarkBucket
            bookmarkPages={bookmarkPages}
            isActivePage={isActivePage}
            activeKey={activeKey}
          />
        )}
      </div>
    </aside>
  );
}

/** @deprecated use ScopeFlyout2 */
export function ScopeFlyout() {
  const { bookmarkPages } = useShell();
  const { activeGrant } = useActiveGrantFromSentinel();
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const scopeLabel = activeGrant
    ? (activeGrant.label_override?.trim() || activeGrant.name)
    : null;
  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeKey = bookmarkPages.find((p) => isActivePage(p.href))?.itemKey ?? null;
  const showBookmarks = !isDevPath(pathname);

  return (
    <aside className="rail-2 rail-2--scope" aria-label="Workspace scope">
      <RailHeader title={scopeLabel} now={now} />
      <div className="rail-2__content rail-2__content--scope vector-scroll">
        <ScopeTreePanel />
        {showBookmarks && (
          <BookmarkBucket
            bookmarkPages={bookmarkPages}
            isActivePage={isActivePage}
            activeKey={activeKey}
          />
        )}
      </div>
    </aside>
  );
}

function PageRow({
  page,
  active,
  nested = false,
  setRef,
}: {
  page: ShellPage;
  active: boolean;
  nested?: boolean;
  setRef: (key: string, el: HTMLElement | null) => void;
}) {
  const { isPinnable, isPageBookmarked, bookmarkPage, unbookmarkPage } = useNavPrefs();
  const [busy, setBusy] = useState(false);
  const pinnable = isPinnable(page.itemKey);
  const bookmarked = pinnable && isPageBookmarked(page.itemKey);

  const onBookmark = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (bookmarked) await unbookmarkPage(page.itemKey);
      else await bookmarkPage(page.itemKey);
    } catch (err) {
      console.error("[bookmark:error]", page.itemKey, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={(el) => setRef(page.itemKey, el as HTMLElement | null)}
      className={`rail-2__nav-row${active ? " is-active" : ""}${nested ? " is-nested" : ""}`}
    >
      <Link
        href={page.href}
        className="rail-2__nav-row_link"
        aria-current={active ? "page" : undefined}
      >
        <span className="rail-2__nav-row_icon">
          <NavIcon iconKey={page.icon} />
        </span>
        <span className="rail-2__nav-row_label">{page.name}</span>
      </Link>
      {pinnable && (
        <span
          role="button"
          className={`rail-2__nav-row_bookmark${bookmarked ? " is-bookmarked" : ""}`}
          onClick={onBookmark}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? `Remove ${page.name} from bookmarks` : `Bookmark ${page.name}`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill={bookmarked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </span>
      )}
    </div>
  );
}
