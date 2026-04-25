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

  const items: React.ReactNode[] = [];
  ordered.forEach((l, i) => {
    items.push(
      <li key={l.id} className="layer-hierarchy__box">
        <span className="layer-hierarchy__tag u-mono">{l.tag}</span>
        <span className="layer-hierarchy__name">{l.name}</span>
      </li>
    );
    if (i < ordered.length - 1) {
      items.push(
        <li key={`arrow-${l.id}`} className="layer-hierarchy__arrow" aria-hidden="true" />
      );
    }
  });

  if (ordered.length > 0) {
    items.push(
      <li key="arrow-custom" className="layer-hierarchy__arrow" aria-hidden="true" />
    );
  }
  items.push(
    <li key="custom" className="layer-hierarchy__box layer-hierarchy__box--custom">
      <span className="layer-hierarchy__tag u-mono">+</span>
      <span className="layer-hierarchy__name">Custom hierarchy</span>
    </li>
  );

  return (
    <ol className="layer-hierarchy" aria-label="Layer hierarchy">
      {items}
    </ol>
  );
}
