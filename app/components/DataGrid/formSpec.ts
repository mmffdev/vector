// FormSpec — declarative form vocabulary for <DataGridFormRenderer>.
//
// A page-owned config can describe a form as data instead of writing
// JSX. The renderer reads the spec and produces the same two-column
// layout + action toolbar shape that ObjectTreeV2's ArtefactInlineForm
// uses today. Pages that want bespoke JSX still can — the spec is
// opt-in. The two paths coexist via the rowFlyout.renderBody seam.
//
// Design rules:
//   1. Field types are a FIXED vocabulary. Adding a new control means
//      adding a new variant here — but pages can also pass `kind:
//      "custom"` with a renderer function for one-off shapes.
//   2. Values flow through a single `value` object keyed by field id.
//      The renderer owns local draft state and commits on blur. Pages
//      receive the patch via `onChange(patch)`.
//   3. Actions are declarative. A button can be marked `danger` and
//      `confirm: true` — the renderer wires the two-state confirm flow
//      (the OTV2 "Delete / Confirm Delete" pattern) automatically.

import type { ReactNode } from "react";

// ── Field vocabulary ────────────────────────────────────────────────────────

export interface BaseField {
  /** Field id — used as the value key. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional hint shown after the label (e.g. "(derived from children)"). */
  hint?: string;
  /** Read-only when true; renderer disables the input. */
  disabled?: boolean;
  /** Hide the field entirely. Computed per-render so pages can derive. */
  hidden?: boolean;
}

export interface TextField extends BaseField {
  kind: "text";
  placeholder?: string;
  /**
   * Commit on every keystroke instead of on blur. Use sparingly — pages
   * read this value live (e.g. the form's accessor-driven header title).
   * Default false: blur-commit, cheaper, no per-keystroke re-render.
   */
  liveCommit?: boolean;
}
export interface TextAreaField extends BaseField {
  kind: "textarea";
  placeholder?: string;
  rows?: number;
  liveCommit?: boolean;
}
export interface NumberField extends BaseField {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  liveCommit?: boolean;
}

export interface SelectOption { value: string; label: string; }
export interface SelectGroup  { label: string; options: SelectOption[]; }
export interface SelectField extends BaseField {
  kind: "select";
  /** Flat options. Mutually exclusive with `groups`. */
  options?: SelectOption[];
  /** Optgrouped options. Mutually exclusive with `options`. */
  groups?:  SelectGroup[];
  /** Placeholder option (empty value). Default: "— None —". */
  placeholder?: string;
}

export interface ToggleField extends BaseField {
  kind: "toggle";
  /** Optional supplementary control rendered when toggle is on (e.g. reason input). */
  renderExtra?: (
    value:    Record<string, unknown>,
    onChange: (patch: Record<string, unknown>) => void,
  ) => ReactNode;
}

export interface StaticField extends BaseField {
  kind: "static";
  /** Renders read-only inline text. */
  render: (value: Record<string, unknown>) => ReactNode;
}

export interface CustomField extends BaseField {
  kind: "custom";
  /** Escape hatch — page renders anything it wants. */
  render: (
    value:    Record<string, unknown>,
    onChange: (patch: Record<string, unknown>) => void,
  ) => ReactNode;
}

export type FormField =
  | TextField
  | TextAreaField
  | NumberField
  | SelectField
  | ToggleField
  | StaticField
  | CustomField;

// ── Layout vocabulary ──────────────────────────────────────────────────────

export interface FormSection {
  /** Stable id for the section. */
  id: string;
  /** Optional section label (rendered as a small heading). */
  label?: string;
  /** Field rows. Each row is a list of fields side-by-side. */
  fields: FormField[];
}

export interface FormColumn {
  id: string;
  sections: FormSection[];
}

export interface FormLayout {
  /** One column = single-column layout. Two columns = OTV2-style split. */
  columns: FormColumn[];
}

// ── Action bar vocabulary ──────────────────────────────────────────────────

export interface FormActionCtx {
  /** Current draft value of the form. */
  value: Record<string, unknown>;
  /** Close the flyout. */
  close: () => void;
  /** Switch to a banner state ('duplicate' = amber, 'deleting' = red, null = normal). */
  setBanner: (state: FormBanner) => void;
}

export type FormBanner = null | "duplicate" | "deleting";

export interface FormAction {
  id: string;
  label: string;
  /** Render as the danger variant (red text). */
  danger?: boolean;
  /**
   * If true, the first click ARMS confirm — replaces the entire toolbar
   * with [Cancel] + [Confirm <label>]. Second click on Confirm fires
   * onClick. Cancel restores the normal toolbar. Matches the OTV2
   * Delete / Confirm Delete pattern exactly.
   */
  confirm?: boolean;
  /** Hide the action entirely (computed per-render). */
  hidden?: (value: Record<string, unknown>) => boolean;
  /** Click handler. Receives the action context. */
  onClick: (ctx: FormActionCtx) => void;
}

// ── The spec ───────────────────────────────────────────────────────────────

export interface FormSpec {
  /** Header band title — supports an accessor over the live value. */
  title: (value: Record<string, unknown>) => string;
  /** Optional banner state derived from the value (e.g. row is a clone). */
  bannerFromValue?: (value: Record<string, unknown>) => FormBanner;
  /** Action toolbar items. */
  actions: FormAction[];
  /** Form layout (1 or 2 columns of stacked sections). */
  layout: FormLayout;
  /** Footer primary action (typically "Finished"). Optional. */
  footer?: {
    label:   string;
    onClick: (ctx: FormActionCtx) => void;
  };
}
