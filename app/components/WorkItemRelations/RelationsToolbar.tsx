"use client";

import { useMemo } from "react";
import type { RelationsFilters } from "./index";
import type { RelationsPayload } from "@/app/api/v2/work-items/relations/route";

type Props = {
  payload: RelationsPayload;
  filters: RelationsFilters;
  onChange: (next: RelationsFilters) => void;
};

export function RelationsToolbar({ payload, filters, onChange }: Props) {
  const allTypes = useMemo(() => {
    const set = new Set<string>();
    for (const n of payload.nodes) set.add(n.type_name);
    return Array.from(set).sort();
  }, [payload.nodes]);

  const toggleType = (t: string) => {
    const next = new Set(filters.types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...filters, types: next });
  };

  return (
    <div className="ui-relations__toolbar">
      <input
        type="search"
        className="form-input"
        placeholder="Search id or title…"
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
      />

      <div className="ui-relations__types">
        {allTypes.map((t) => {
          const on = filters.types.size === 0 || filters.types.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`pill pill--tag${on ? "" : " is-off"}`}
              onClick={() => toggleType(t)}
            >
              {t}
            </button>
          );
        })}
      </div>

      <label className="ui-relations__depth">
        Depth:&nbsp;
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={filters.maxDepth ?? 10}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({ ...filters, maxDepth: v >= 10 ? null : v });
          }}
        />
        <span>{filters.maxDepth ?? "∞"}</span>
      </label>

      <div className="ui-relations__neighbour">
        <label className="ui-relations__neighbour-toggle">
          <input
            type="checkbox"
            checked={filters.neighbourMode}
            onChange={(e) => onChange({ ...filters, neighbourMode: e.target.checked })}
          />
          Focus neighbourhood
        </label>
        {filters.neighbourMode && (
          <label className="ui-relations__neighbour-depth">
            Hops:&nbsp;
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={filters.neighbourDepth}
              onChange={(e) =>
                onChange({ ...filters, neighbourDepth: Number(e.target.value) })
              }
            />
            <span>{filters.neighbourDepth}</span>
          </label>
        )}
      </div>
    </div>
  );
}
