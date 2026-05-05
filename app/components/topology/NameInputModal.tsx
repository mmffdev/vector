"use client";

import { useEffect, useRef, useState } from "react";
import Panel from "@/app/components/Panel";

export function NameInputModal({
  title,
  placeholder,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  // PLA-0006/00336 — registers the modal under
  // samantha._viewport.app._kind.panel.topology_name_input_modal so
  // Samantha can target it. `panel--bare` strips Panel chrome.
  return (
    <Panel name="topology_name_input_modal" className="panel--bare">
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
        </header>
        <div className="modal__body">
          <input
            ref={inputRef}
            type="text"
            className="form__input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <footer className="modal__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={submit}
            disabled={!value.trim()}
          >
            OK
          </button>
        </footer>
      </div>
    </div>
    </Panel>
  );
}
