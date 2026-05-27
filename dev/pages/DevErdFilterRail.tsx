"use client";

import type { ErdResponse, Filters } from "./DevErdPanel";

type Props = {
  data: ErdResponse | null;
  filters: Filters | null;
  setFilters: (f: Filters) => void;
};

export default function DevErdFilterRail({ data, filters, setFilters }: Props) {
  if (!data || !filters) return <aside className="dui-erd-rail" />;

  function toggle<T>(set: Set<T>, key: T): Set<T> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }

  return (
    <aside className="dui-erd-rail">
      <h3>Databases</h3>
      {data.databases.map((d) => (
        <label key={d.name}>
          <input
            type="checkbox"
            checked={filters.databases.has(d.name)}
            onChange={() => setFilters({ ...filters, databases: toggle(filters.databases, d.name) })}
          />
          {d.name}
        </label>
      ))}

      <h3>Groups</h3>
      {data.groups.map((g) => (
        <label key={g.id}>
          <input
            type="checkbox"
            checked={filters.groups.has(g.id)}
            onChange={() => setFilters({ ...filters, groups: toggle(filters.groups, g.id) })}
          />
          {g.label}
        </label>
      ))}

      <h3>Edge kinds</h3>
      {(["hard_fk", "soft_ref"] as const).map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            checked={filters.edgeKinds.has(k)}
            onChange={() => setFilters({ ...filters, edgeKinds: toggle(filters.edgeKinds, k) })}
          />
          {k === "hard_fk" ? "Hard FK" : "Soft ref"}
        </label>
      ))}
    </aside>
  );
}
