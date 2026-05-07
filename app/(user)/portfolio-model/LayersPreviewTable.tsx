"use client";

import InlineEditField from "@/app/components/InlineEditField";
import { type LayerDTO } from "./LayersTable";

interface Props {
  layers: LayerDTO[];
  fixedItems?: LayerDTO[];
  topAnchorTag?: string;
  strategyGroupLabel?: string;
  fixedGroupLabel?: string;
  panelNum?: string;
  panelTitle?: string;
  panelSubtitle?: string;
  onCommitLayer?: (id: string, field: "name" | "tag" | "description_md", next: string) => boolean | void;
}

function sorted(layers: LayerDTO[]): LayerDTO[] {
  return [...layers].sort((a, b) => a.sort_order - b.sort_order);
}

export default function LayersPreviewTable({
  layers,
  fixedItems,
  strategyGroupLabel,
  fixedGroupLabel,
  panelNum,
  panelTitle,
  panelSubtitle,
  onCommitLayer,
}: Props) {
  const editable = Boolean(onCommitLayer);

  function renderTag(layer: LayerDTO) {
    if (!editable) return <>{layer.tag}</>;
    return (
      <InlineEditField
        value={layer.tag}
        onCommit={(next) => onCommitLayer!(layer.id, "tag", next)}
        ariaLabel="Layer tag"
        inputClassName="form__input form__input--sm"
        displayClassName="inline-edit-trigger"
        clickToEdit
        allowEmpty
        maxLength={4}
      />
    );
  }

  function renderName(layer: LayerDTO) {
    if (!editable) return <>{layer.name}</>;
    return (
      <InlineEditField
        value={layer.name}
        onCommit={(next) => onCommitLayer!(layer.id, "name", next)}
        ariaLabel="Layer name"
        inputClassName="form__input form__input--sm"
        displayClassName="inline-edit-trigger"
        clickToEdit
        allowEmpty
        maxLength={120}
      />
    );
  }

  function renderDesc(layer: LayerDTO) {
    if (!editable) return <>{layer.description_md ?? "—"}</>;
    return (
      <InlineEditField
        value={layer.description_md ?? ""}
        onCommit={(next) => onCommitLayer!(layer.id, "description_md", next)}
        ariaLabel="Layer description"
        inputClassName="form__input form__input--sm"
        displayClassName="inline-edit-trigger"
        clickToEdit
        allowEmpty
        emptyDisplay="—"
        maxLength={2000}
      />
    );
  }
  const fixedOffset = fixedItems
    ? Math.max(0, ...fixedItems.map((f) => f.sort_order))
    : 0;

  const displayLayers = [...sorted(layers)].reverse();
  const displayFixed = [...(fixedItems ?? [])].sort((a, b) => b.sort_order - a.sort_order);

  return (
    <div>
      {(panelTitle || panelSubtitle) && (
        <header className="tree_accordion-dense__panel-head">
          {panelNum && (
            <span className="tree_accordion-dense__panel-head-num">{panelNum}</span>
          )}
          <div className="tree_accordion-dense__panel-head-body">
            {panelTitle && (
              <h3 className="tree_accordion-dense__panel-head-title">{panelTitle}</h3>
            )}
            {panelSubtitle && (
              <p className="tree_accordion-dense__panel-head-subtitle">{panelSubtitle}</p>
            )}
          </div>
        </header>
      )}
      <div className="tree_accordion-dense__scroll">
      <table className="tree_accordion-dense__table" aria-label="Portfolio hierarchy preview">
        <colgroup>
          <col style={{ width: 80 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 200 }} />
          <col />
        </colgroup>
        <thead className="tree_accordion-dense__head">
          <tr>
            <th className="tree_accordion-dense__th tree_accordion-dense__th--numeric">Order</th>
            <th className="tree_accordion-dense__th tree_accordion-dense__th--mono">Tag</th>
            <th className="tree_accordion-dense__th">Name</th>
            <th className="tree_accordion-dense__th">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr className="tree_accordion-dense__row tree_accordion-dense__row--epic">
            <td className="tree_accordion-dense__cell" colSpan={4}>
              <span className="eyebrow">{strategyGroupLabel ?? "Strategy Zone"}</span>
            </td>
          </tr>
          {displayLayers.map((layer, index) => (
            <tr
              key={layer.id}
              className={
                layer.is_placeholder
                  ? "tree_accordion-dense__row is-placeholder"
                  : "tree_accordion-dense__row"
              }
            >
              <td className="tree_accordion-dense__cell tree_accordion-dense__cell--numeric tree_accordion-dense__cell--mono">
                {displayLayers.length - index + fixedOffset}
              </td>
              <td className="tree_accordion-dense__cell tree_accordion-dense__cell--mono">
                {renderTag(layer)}
              </td>
              <td className="tree_accordion-dense__cell">
                {layer.is_placeholder ? (
                  <>
                    {renderName(layer)}{" "}
                    <span className="pill pill--warning" aria-label="Pending re-classification">
                      Pending re-classification
                    </span>
                  </>
                ) : (
                  renderName(layer)
                )}
              </td>
              <td className="tree_accordion-dense__cell">{renderDesc(layer)}</td>
            </tr>
          ))}
          {displayFixed.length > 0 && (
            <>
              <tr className="tree_accordion-dense__row tree_accordion-dense__row--epic">
                <td className="tree_accordion-dense__cell" colSpan={4}>
                  <span className="eyebrow">{fixedGroupLabel ?? "Execution Zone"}</span>
                </td>
              </tr>
              {displayFixed.map((item) => (
                <tr key={item.id} className="tree_accordion-dense__row tree_accordion-dense__row--child">
                  <td className="tree_accordion-dense__cell tree_accordion-dense__cell--numeric tree_accordion-dense__cell--mono">
                    {item.sort_order === 0 ? "—" : item.sort_order}
                  </td>
                  <td className="tree_accordion-dense__cell tree_accordion-dense__cell--mono">
                    {item.tag}
                  </td>
                  <td className="tree_accordion-dense__cell">{item.name}</td>
                  <td className="tree_accordion-dense__cell">
                    {item.description_md ?? "—"}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
