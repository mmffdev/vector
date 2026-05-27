"use client";

import type { ErdEdge, ErdNode } from "./DevErdPanel";

function isNode(x: ErdNode | ErdEdge): x is ErdNode {
  return (x as ErdNode).columns !== undefined;
}

type Props = { selected: ErdNode | ErdEdge | null };

export default function DevErdInspector({ selected }: Props) {
  if (!selected) {
    return <aside className="dui-erd-inspector"><p>Click a table or edge.</p></aside>;
  }
  if (isNode(selected)) {
    return (
      <aside className="dui-erd-inspector">
        <h3>{selected.table}</h3>
        <p>{selected.database} · {selected.row_count} rows · group: {selected.group}</p>
        <h4>Columns</h4>
        <ul>
          {selected.columns.map((c) => (
            <li key={c.name}>
              {c.name} <em>{c.type}</em>
              {c.is_pk && " · PK"}
              {c.is_fk && " · FK"}
              {c.nullable && " · NULL"}
            </li>
          ))}
        </ul>
      </aside>
    );
  }
  return (
    <aside className="dui-erd-inspector">
      <h3>{selected.kind === "hard_fk" ? "Hard FK" : "Soft ref"}</h3>
      <p>{selected.from} → {selected.to}</p>
      {selected.from_column && <p>{selected.from_column} → {selected.to_column}</p>}
      {selected.on_delete && <p>ON DELETE {selected.on_delete}</p>}
      {selected.evidence && <p>Evidence: {selected.evidence}</p>}
    </aside>
  );
}
