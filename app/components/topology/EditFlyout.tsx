"use client";

import { useEffect, useRef, useState } from "react";
import { topologyApi, type OrgNode } from "@/app/lib/topologyApi";
import Panel from "@/app/components/Panel";
import { COLOUR_PALETTE } from "./types";
import { useGlobalKey } from "./useGlobalKey";

function ColourSwatch({
  colour,
  active,
  onClick,
}: {
  colour: string;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--swatch-bg", colour);
  }, [colour]);
  return (
    <button
      ref={ref}
      type="button"
      className={`topo-flyout__swatch topo-color-swatch${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-label={`Use colour ${colour}`}
    />
  );
}

export function EditFlyout({
  node,
  onClose,
  onChange,
}: {
  node: OrgNode;
  onClose: () => void;
  onChange: () => void;
}) {
  const [draftName, setDraftName] = useState(node.name);
  const [draftDescription, setDraftDescription] = useState(node.description ?? "");
  const [draftLabel, setDraftLabel] = useState(node.label_override ?? "");
  const [draftColour, setDraftColour] = useState(node.colour ?? "");
  const [error, setError] = useState<string | null>(null);

  // ESC closes the flyout — but only when no input is focused, so the
  // user's keystroke inside Name/Label/Description doesn't get hijacked
  // away from the field-level "Escape blurs" handler that already exists.
  useGlobalKey("Escape", () => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    onClose();
  });

  // Resync drafts ONLY when switching to a different node. Resyncing on
  // every node-field change clobbered the user's in-flight typing whenever
  // a save round-tripped through the tree reload — that produced the
  // dropped-character bug ("Back Office" → "Bak Ofice").
  useEffect(() => {
    setDraftName(node.name);
    setDraftDescription(node.description ?? "");
    setDraftLabel(node.label_override ?? "");
    setDraftColour(node.colour ?? "");
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchOne = async (
    field: "name" | "description" | "label_override" | "colour",
    value: string,
  ) => {
    setError(null);
    try {
      await topologyApi.patchFields(node.id, { [field]: value });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Update of ${field} failed`);
    }
  };

  // Save on blur / Enter, not on every keystroke. Typing stays purely local.
  const commitName = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setDraftName(node.name); // can't clear name; revert
      return;
    }
    if (trimmed === node.name) return;
    void patchOne("name", trimmed);
  };

  const commitDescription = () => {
    if (draftDescription === (node.description ?? "")) return;
    void patchOne("description", draftDescription);
  };

  const commitLabel = () => {
    if (draftLabel === (node.label_override ?? "")) return;
    void patchOne("label_override", draftLabel);
  };

  // Colour comes from a swatch click, not free text — commit immediately.
  const onColourChange = (v: string) => {
    setDraftColour(v);
    void patchOne("colour", v);
  };

  return (
    <aside className="topo-flyout" role="dialog" aria-label={`Edit ${node.name}`}>
      <header className="topo-flyout__head">
        <h2 className="modal__title">Edit node</h2>
        <button
          type="button"
          className="btn btn--icon btn--ghost btn--sm topo-flyout__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {/* Wrapping the body in <Panel> registers this flyout as an
          addressable in its own right ("topology_edit_flyout") so its help
          hexagon is scoped to THIS panel — stops the underlying topology
          panel's hexagon bleeding through the z-index. Address resolves to
          samantha._viewport.app._kind.panel.topology_edit_flyout (the
          flyout renders as a sibling of the canvas panel inside __main,
          not nested under it, so no parent prefix appears). */}
      <Panel name="topology_edit_flyout" className="panel--bare topo-flyout__panel">
      <div className="topo-flyout__body">
        <label className="form__row topo-flyout__field">
          <span className="form__label">Name</span>
          <input
            type="text"
            className="form__input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
        </label>

        <label className="form__row topo-flyout__field">
          <span className="form__label">Label</span>
          <input
            type="text"
            className="form__input"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="e.g. Department, Office, Team"
          />
        </label>

        <label className="form__row topo-flyout__field">
          <span className="form__label">Description</span>
          <textarea
            className="form__textarea"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            onBlur={commitDescription}
            rows={4}
            placeholder="What this node owns, who it serves."
          />
        </label>

        <div className="form__row topo-flyout__field">
          <span className="form__label">Colour</span>
          <div className="topo-flyout__swatches">
            {COLOUR_PALETTE.map((c) => (
              <ColourSwatch
                key={c}
                colour={c}
                active={draftColour === c}
                onClick={() => onColourChange(c)}
              />
            ))}
            <button
              type="button"
              className={`topo-flyout__swatch topo-flyout__swatch--clear${draftColour === "" ? " is-active" : ""}`}
              onClick={() => onColourChange("")}
              aria-label="Clear colour"
              title="Auto colour"
            >
              ⊘
            </button>
          </div>
        </div>

        {error && <p className="form__error">{error}</p>}
      </div>
      </Panel>
    </aside>
  );
}
