"use client";

// Grid__Tree_Pagination — the root-pagination band of the canonical skin.
//
// The THIRD sibling inside <div class="grid">, after Grid__Tree_Rows. It reads
// the root-window state straight off the useTree result the skin already holds
// (total / loadedCount / hasMore / currentPage / rootsLoading) and drives it
// via loadMore / jumpToPage. No consumer props — the band is fed by the hook,
// matching the "tree owns its own pagination" contract.
//
// Two modes co-exist (per the design): load-more APPENDS the next page below
// the window (preserves expansion); the page-jump REPLACES the window (resets
// expansion). Left = count, centre = load-more, right = page-jump.

import { useState } from "react";
import type { UseTreeResult } from "./types";

export interface GridTreePaginationProps<TRow> {
  tree: UseTreeResult<TRow>;
}

export function GridTreePagination<TRow>({
  tree,
}: GridTreePaginationProps<TRow>) {
  const { total, loadedCount, pageSize, hasMore, currentPage, rootsLoading } =
    tree;

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  // 1-based for display; currentPage is 0-based from the hook.
  const [jumpDraft, setJumpDraft] = useState<string>("");

  // Nothing loaded yet → don't paint a confusing "0 of 0" band.
  if (total === 0 && loadedCount === 0) return null;

  const commitJump = () => {
    const n = parseInt(jumpDraft, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= pageCount) {
      tree.jumpToPage(n - 1);
    }
    setJumpDraft("");
  };

  const prevDisabled = currentPage <= 0 || rootsLoading;
  const nextDisabled = currentPage >= pageCount - 1 || rootsLoading;

  return (
    <div
      className={`grid__Tree_Pagination${
        rootsLoading ? " grid__Tree_Pagination--loading" : ""
      }`}
      role="navigation"
      aria-label="Root pagination"
    >
      <span className="grid__Tree_Pagination_Count">
        Showing {loadedCount} of {total}
      </span>

      <div className="grid__Tree_Pagination_More">
        <button
          type="button"
          className="grid__Tree_Pagination_LoadMore"
          onClick={() => tree.loadMore()}
          disabled={!hasMore || rootsLoading}
        >
          {rootsLoading ? "Loading…" : "Load more"}
        </button>
      </div>

      <div className="grid__Tree_Pagination_Jump">
        <button
          type="button"
          className="grid__Tree_Pagination_NavBtn"
          aria-label="Previous page"
          onClick={() => tree.jumpToPage(currentPage - 1)}
          disabled={prevDisabled}
        >
          ‹
        </button>
        <span className="grid__Tree_Pagination_PageLabel">
          Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="grid__Tree_Pagination_NavBtn"
          aria-label="Next page"
          onClick={() => tree.jumpToPage(currentPage + 1)}
          disabled={nextDisabled}
        >
          ›
        </button>
        <input
          className="grid__Tree_Pagination_JumpInput"
          type="number"
          min={1}
          max={pageCount}
          inputMode="numeric"
          aria-label="Jump to page"
          placeholder="Go to…"
          value={jumpDraft}
          onChange={(e) => setJumpDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitJump();
          }}
          onBlur={commitJump}
          disabled={rootsLoading}
        />
      </div>
    </div>
  );
}
