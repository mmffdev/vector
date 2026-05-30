"use client";

// <FormRenderer> — the spec-driven body component for DataGrid row
// flyouts. Replicates ObjectTreeV2's ArtefactInlineForm layout from a
// declarative FormSpec.
//
// Layout shape:
//   ── Header band (title + banner colour: normal | duplicate | deleting)
//   ── Action toolbar (Duplicate / Add Tasks / … / Delete — with the
//      two-state confirm flow when an action has confirm:true)
//   ── Two-column body (or one column — driven by layout.columns)
//      Each column → list of sections → list of fields
//   ── Footer (single "Finished" primary button)
//
// State model:
//   - The page hands us initial values; we keep our own draft state.
//   - Local input controls own per-key draft state; blur commits to draft.
//   - Action handlers receive the current draft via `ctx.value`.
//   - The renderer NEVER fetches, NEVER persists. Pages do both via
//     their action handlers; this component is presentation + state.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CustomField,
  FormAction,
  FormActionCtx,
  FormBanner,
  FormField,
  FormSection,
  FormSpec,
  NumberField,
  SelectField,
  StaticField,
  TextAreaField,
  TextField,
  ToggleField,
} from "./formSpec";

export interface FormRendererProps {
  spec: FormSpec;
  /** Initial value object (typically the fetched detail row). */
  initial: Record<string, unknown>;
  /** Called on every committed field change (after blur / select / toggle). */
  onChange?: (patch: Record<string, unknown>) => void;
  /** Called when the close affordance fires (Finished button etc.). */
  onClose: () => void;
}

export function FormRenderer({
  spec,
  initial,
  onChange,
  onClose,
}: FormRendererProps) {
  const [value,        setValue]        = useState<Record<string, unknown>>(initial);
  const [armedActionId, setArmedActionId] = useState<string | null>(null);
  const [bannerOverride, setBannerOverride] = useState<FormBanner>(null);

  // Re-seed when initial changes (e.g. user switches row → fetch resolves).
  useEffect(() => { setValue(initial); setArmedActionId(null); setBannerOverride(null); }, [initial]);

  const commit = useCallback(
    (patch: Record<string, unknown>) => {
      setValue((prev) => ({ ...prev, ...patch }));
      onChange?.(patch);
    },
    [onChange],
  );

  // Banner: explicit override > spec-derived > none. Armed-delete forces deleting.
  const banner: FormBanner = useMemo(() => {
    if (armedActionId) {
      const a = spec.actions.find((x) => x.id === armedActionId);
      if (a?.danger) return "deleting";
    }
    if (bannerOverride !== null) return bannerOverride;
    return spec.bannerFromValue?.(value) ?? null;
  }, [armedActionId, bannerOverride, spec, value]);

  const ctx: FormActionCtx = useMemo(
    () => ({ value, close: onClose, setBanner: setBannerOverride }),
    [value, onClose],
  );

  const armedAction = armedActionId ? spec.actions.find((a) => a.id === armedActionId) ?? null : null;

  const title = spec.title(value);
  const headClass =
    "data-grid__form_Head" +
    (banner === "deleting"  ? " data-grid__form_Head-deleting"  : "") +
    (banner === "duplicate" ? " data-grid__form_Head-duplicate" : "");

  return (
    <div className="data-grid__form">
      <header className={headClass}>
        <h2 className="data-grid__form_Head_Title">{title}</h2>
      </header>

      <div className="data-grid__form_Actionbar" role="toolbar" aria-label="Form actions">
        {armedAction ? (
          <>
            <button
              type="button"
              className="data-grid__form_Actionbar_Btn"
              onClick={() => setArmedActionId(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="data-grid__form_Actionbar_Btn data-grid__form_Actionbar_Btn-danger data-grid__form_Actionbar_Btn-confirm"
              onClick={() => { armedAction.onClick(ctx); setArmedActionId(null); }}
            >
              Confirm {armedAction.label}
            </button>
            <span className="data-grid__form_Actionbar_Spacer" />
          </>
        ) : (
          <>
            {spec.actions.map((a) => (a.hidden?.(value) ? null : (
              <ActionButton key={a.id} action={a} onArm={setArmedActionId} ctx={ctx} />
            )))}
            <span className="data-grid__form_Actionbar_Spacer" />
          </>
        )}
      </div>

      <div
        className="data-grid__form_Cols"
        data-columns={spec.layout.columns.length}
      >
        {spec.layout.columns.map((col) => (
          <div key={col.id} className="data-grid__form_Cols_Col">
            {col.sections.map((s) => (
              <SectionView key={s.id} section={s} value={value} onChange={commit} />
            ))}
          </div>
        ))}
      </div>

      {spec.footer && (
        <div className="data-grid__form_Footer">
          <button
            type="button"
            className="data-grid__form_Footer_Btn data-grid__form_Footer_Btn-primary"
            onClick={() => spec.footer!.onClick(ctx)}
          >
            {spec.footer.label}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Action button (handles arm-on-confirm) ──────────────────────────────────

function ActionButton({
  action,
  onArm,
  ctx,
}: {
  action: FormAction;
  onArm:  (id: string | null) => void;
  ctx:    FormActionCtx;
}) {
  const cls =
    "data-grid__form_Actionbar_Btn" +
    (action.danger ? " data-grid__form_Actionbar_Btn-danger" : "");
  return (
    <button
      type="button"
      className={cls}
      onClick={() => (action.confirm ? onArm(action.id) : action.onClick(ctx))}
    >
      {action.label}
    </button>
  );
}

// ─── Section / Field dispatch ────────────────────────────────────────────────

function SectionView({
  section,
  value,
  onChange,
}: {
  section:  FormSection;
  value:    Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <section className="data-grid__form_Section">
      {section.label && <h4 className="data-grid__form_Section_Label">{section.label}</h4>}
      {section.fields.map((f) => (f.hidden ? null : (
        <FieldView key={f.id} field={f} value={value} onChange={onChange} />
      )))}
    </section>
  );
}

function FieldView({
  field,
  value,
  onChange,
}: {
  field:    FormField;
  value:    Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  switch (field.kind) {
    case "text":     return <TextInput     field={field} value={value} onChange={onChange} />;
    case "textarea": return <TextAreaInput field={field} value={value} onChange={onChange} />;
    case "number":   return <NumberInput   field={field} value={value} onChange={onChange} />;
    case "select":   return <SelectInput   field={field} value={value} onChange={onChange} />;
    case "toggle":   return <ToggleInput   field={field} value={value} onChange={onChange} />;
    case "static":   return <StaticView    field={field} value={value} />;
    case "custom":   return <CustomView    field={field} value={value} onChange={onChange} />;
  }
}

// ─── Field primitives ────────────────────────────────────────────────────────

function FieldShell({
  label,
  hint,
  children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="data-grid__form_Field">
      <span className="data-grid__form_Field_Label">
        {label}
        {hint && <span className="data-grid__form_Field_Label_Hint">&nbsp;{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({ field, value, onChange }: { field: TextField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const initial = (value[field.id] as string) ?? "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <FieldShell label={field.label} hint={field.hint}>
      <input
        type="text"
        className="data-grid__form_Field_Input"
        value={draft}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (field.liveCommit) onChange({ [field.id]: e.target.value });
        }}
        onBlur={() => { if (!field.liveCommit && draft !== initial) onChange({ [field.id]: draft }); }}
      />
    </FieldShell>
  );
}

function TextAreaInput({ field, value, onChange }: { field: TextAreaField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const initial = (value[field.id] as string) ?? "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <FieldShell label={field.label} hint={field.hint}>
      <textarea
        className="data-grid__form_Field_Input data-grid__form_Field_Input-textarea"
        value={draft}
        rows={field.rows ?? 4}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (field.liveCommit) onChange({ [field.id]: e.target.value });
        }}
        onBlur={() => { if (!field.liveCommit && draft !== initial) onChange({ [field.id]: draft }); }}
      />
    </FieldShell>
  );
}

function NumberInput({ field, value, onChange }: { field: NumberField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const raw = value[field.id];
  const initial = raw == null ? "" : String(raw);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);

  const commitParsed = (s: string) => {
    const parsed = s === "" ? null : parseFloat(s);
    onChange({ [field.id]: Number.isFinite(parsed as number) ? parsed : null });
  };

  return (
    <FieldShell label={field.label} hint={field.hint}>
      <input
        type="number"
        className="data-grid__form_Field_Input"
        value={draft}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        disabled={field.disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (field.liveCommit) commitParsed(e.target.value);
        }}
        onBlur={() => {
          if (field.liveCommit) return;
          const next = draft === "" ? null : parseFloat(draft);
          const cur  = raw;
          if (next !== cur) commitParsed(draft);
        }}
      />
    </FieldShell>
  );
}

function SelectInput({ field, value, onChange }: { field: SelectField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const cur = (value[field.id] as string) ?? "";
  return (
    <FieldShell label={field.label} hint={field.hint}>
      <select
        className="data-grid__form_Field_Input"
        value={cur}
        disabled={field.disabled}
        onChange={(e) => onChange({ [field.id]: e.target.value })}
      >
        <option value="">{field.placeholder ?? "— None —"}</option>
        {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {field.groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>
    </FieldShell>
  );
}

function ToggleInput({ field, value, onChange }: { field: ToggleField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const cur = !!value[field.id];
  return (
    <div className="data-grid__form_Field">
      <span className="data-grid__form_Field_Label">{field.label}</span>
      <label className="data-grid__form_Toggle">
        <input
          type="checkbox"
          checked={cur}
          disabled={field.disabled}
          onChange={(e) => onChange({ [field.id]: e.target.checked })}
        />
        <span>{cur ? "On" : "Off"}</span>
      </label>
      {cur && field.renderExtra?.(value, onChange)}
    </div>
  );
}

function StaticView({ field, value }: { field: StaticField; value: Record<string, unknown> }) {
  return (
    <div className="data-grid__form_Field data-grid__form_Field-static">
      <span className="data-grid__form_Field_Label">{field.label}</span>
      <span className="data-grid__form_Field_Static">{field.render(value)}</span>
    </div>
  );
}

function CustomView({ field, value, onChange }: { field: CustomField; value: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="data-grid__form_Field">
      <span className="data-grid__form_Field_Label">{field.label}</span>
      {field.render(value, onChange)}
    </div>
  );
}
