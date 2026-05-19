"use client";

import type { RelationsNode } from "@/app/components/MapRelationship3D/types";

type Props = {
  node: RelationsNode | null;
  onClose: () => void;
};

export function RelationsSidebar({ node, onClose }: Props) {
  if (!node) {
    return (
      <aside className="ui-relations__sidebar ui-relations__sidebar--empty">
        <div className="placeholder__body">
          Select a node in the graph to see its details.
        </div>
      </aside>
    );
  }

  return (
    <aside className="ui-relations__sidebar">
      <header className="ui-relations__sidebar-head">
        <span className="pill pill--tag">{node.type_name}</span>
        <span className="ui-relations__sidebar-id">
          {node.prefix}-{node.number}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onClose}
          aria-label="Close detail"
        >
          ×
        </button>
      </header>

      <h3 className="ui-relations__sidebar-title">{node.title}</h3>

      <dl className="ui-relations__sidebar-meta">
        <dt>State</dt>
        <dd>{node.state_name ?? "—"}</dd>

        <dt>Depth</dt>
        <dd>{node.depth}</dd>

        <dt>Descendants</dt>
        <dd>{node.descendant_count}</dd>

        <dt>Parent</dt>
        <dd>{node.parent_id ? <code>{node.parent_id}</code> : "—"}</dd>
      </dl>

      <a
        href={`/work-items?focus=${node.id}`}
        className="btn btn--secondary"
      >
        Open in list
      </a>
    </aside>
  );
}
