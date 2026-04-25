interface LayerLite {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
}

interface LayerHierarchyDiagramProps {
  layers: LayerLite[];
}

export default function LayerHierarchyDiagram({ layers }: LayerHierarchyDiagramProps) {
  const ordered = [...layers].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <ol className="layer-hierarchy" aria-label="Layer hierarchy">
      {ordered.map((l) => (
        <li key={l.id} className="layer-hierarchy__box">
          <span className="layer-hierarchy__tag u-mono">{l.tag}</span>
          <span className="layer-hierarchy__name">{l.name}</span>
        </li>
      ))}
      <li className="layer-hierarchy__box layer-hierarchy__box--custom">
        <span className="layer-hierarchy__tag u-mono">+</span>
        <span className="layer-hierarchy__name">Custom hierarchy</span>
      </li>
    </ol>
  );
}
