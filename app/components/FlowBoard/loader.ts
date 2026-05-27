// FlowBoard sidecar loader — FB1.3.1
//
// Validates a raw sidecar JSON against the FlowBoardConfig interface,
// applies any per-mount configOverride, and returns a deep-frozen
// result. Mirrors the ObjectTreeV2/loader.ts approach: loud failure on
// bad input beats silent fallback — a misconfigured sidecar should
// surface as an error, not a board with invisible WIP limits.
//
// Usage:
//   import raw from "@/app/components/FlowBoard/configs/p_wizard_flowboard_workitems.json";
//   import { loadFlowBoardConfig } from "@/app/components/FlowBoard/loader";
//   const config = loadFlowBoardConfig(raw);
//
// Validation walks every top-level key and nested sub-object; throws a
// descriptive error naming the failing key + expected type.

// ── Public types ─────────────────────────────────────────────────────────────

export interface FlowBoardConfig {
  /** Addressable slot suffix: `samantha._viewport.app._kind.panel.flow_board_<name>` */
  name: string;
  /** Display title for the panel chrome. */
  title: string;
  /** One-sentence description shown in admin/config surfaces. */
  description: string;
  panel: {
    tone: "neutral" | "danger" | "success" | "info";
    radius: "sm" | "md" | "lg";
    padding: "sm" | "md" | "lg";
    /** Title rendered inside the panel chrome header band. */
    title: string;
    show_panel_chrome: boolean;
  };
  /** Scope of artefact types shown in the type switcher. */
  artefact_type_scope: "work" | "strategy";
  /** Artefact-type prefixes excluded from the board (e.g. ["EP"] — Epics). */
  exclude_prefixes: string[];
  /** Prefix selected by default before the user changes the switcher. */
  default_artefact_type_prefix: string;
  type_switcher: {
    show: boolean;
    /** Label for the switcher control. */
    label: string;
  };
  card: {
    /** Ordered field keys shown on each card until the user customises. */
    default_fields: string[];
    /** Card layout variant. "standard" is the only shipped v1 renderer. */
    renderer: "standard" | "compact" | "rich";
  };
  columns: {
    show_wip: boolean;
    /** Format string for the WIP counter header (`Doing (11/10) +1`). */
    wip_format: "ratio_with_overage";
    /** Badge tone applied when a column exceeds its WIP limit. */
    overage_tone: "danger" | "warning";
    /** Minimum width per column in px — Rally-style. Columns grow
     *  equally to share spare width when the panel is wider than
     *  count × min-width; otherwise the rail scrolls horizontally and
     *  columns stay pinned to this minimum. Default 280. */
    column_min_width: number;
  };
  transitions: {
    /** v1: "strict" — board only allows transitions that are in flow_transitions. */
    mode: "strict";
  };
  empty: {
    /** Heading shown when a column has zero cards. */
    title: string;
    /** Body copy shown beneath the empty heading. */
    body: string;
  };
}

// ── Type guards (private) ─────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (!isString(v)) {
    throw new Error(
      `[FlowBoard loader] "${ctx}.${key}" must be a string — got ${JSON.stringify(v)}`
    );
  }
  return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string, ctx: string): boolean {
  const v = obj[key];
  if (!isBoolean(v)) {
    throw new Error(
      `[FlowBoard loader] "${ctx}.${key}" must be a boolean — got ${JSON.stringify(v)}`
    );
  }
  return v;
}

function requireStringArray(obj: Record<string, unknown>, key: string, ctx: string): string[] {
  const v = obj[key];
  if (!isStringArray(v)) {
    throw new Error(
      `[FlowBoard loader] "${ctx}.${key}" must be a string[] — got ${JSON.stringify(v)}`
    );
  }
  return v;
}

function requireObject(obj: Record<string, unknown>, key: string, ctx: string): Record<string, unknown> {
  const v = obj[key];
  if (!isObject(v)) {
    throw new Error(
      `[FlowBoard loader] "${ctx}.${key}" must be a plain object — got ${JSON.stringify(v)}`
    );
  }
  return v;
}

function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
  allowed: readonly T[]
): T {
  const v = obj[key];
  if (!isString(v) || !(allowed as readonly string[]).includes(v)) {
    throw new Error(
      `[FlowBoard loader] "${ctx}.${key}" must be one of ${JSON.stringify(allowed)} — got ${JSON.stringify(v)}`
    );
  }
  return v as T;
}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateFlowBoardConfig(raw: Record<string, unknown>): FlowBoardConfig {
  // Top-level scalar fields
  const name = requireString(raw, "name", "root");
  const title = requireString(raw, "title", "root");
  const description = requireString(raw, "description", "root");

  // panel
  const panelRaw = requireObject(raw, "panel", "root");
  const panel: FlowBoardConfig["panel"] = {
    tone: requireEnum(panelRaw, "tone", "panel", ["neutral", "danger", "success", "info"]),
    radius: requireEnum(panelRaw, "radius", "panel", ["sm", "md", "lg"]),
    padding: requireEnum(panelRaw, "padding", "panel", ["sm", "md", "lg"]),
    title: requireString(panelRaw, "title", "panel"),
    show_panel_chrome: requireBoolean(panelRaw, "show_panel_chrome", "panel"),
  };

  // artefact_type_scope
  const artefact_type_scope = requireEnum(
    raw,
    "artefact_type_scope",
    "root",
    ["work", "strategy"]
  );

  // exclude_prefixes
  const exclude_prefixes = requireStringArray(raw, "exclude_prefixes", "root");

  // default_artefact_type_prefix
  const default_artefact_type_prefix = requireString(raw, "default_artefact_type_prefix", "root");

  // type_switcher
  const tswRaw = requireObject(raw, "type_switcher", "root");
  const type_switcher: FlowBoardConfig["type_switcher"] = {
    show: requireBoolean(tswRaw, "show", "type_switcher"),
    label: requireString(tswRaw, "label", "type_switcher"),
  };

  // card
  const cardRaw = requireObject(raw, "card", "root");
  const card: FlowBoardConfig["card"] = {
    default_fields: requireStringArray(cardRaw, "default_fields", "card"),
    renderer: requireEnum(cardRaw, "renderer", "card", ["standard", "compact", "rich"]),
  };

  // columns
  const colsRaw = requireObject(raw, "columns", "root");
  const minWidthRaw = (colsRaw as Record<string, unknown>).column_min_width;
  // Optional with default 280px. Validate only when provided so the
  // sidecar can omit it for the common case.
  let columnMinWidth = 280;
  if (minWidthRaw !== undefined) {
    if (typeof minWidthRaw !== "number" || !Number.isFinite(minWidthRaw) || minWidthRaw < 100) {
      throw new Error(
        "columns.column_min_width must be a number ≥ 100 when provided",
      );
    }
    columnMinWidth = Math.floor(minWidthRaw);
  }
  const columns: FlowBoardConfig["columns"] = {
    show_wip: requireBoolean(colsRaw, "show_wip", "columns"),
    wip_format: requireEnum(colsRaw, "wip_format", "columns", ["ratio_with_overage"]),
    overage_tone: requireEnum(colsRaw, "overage_tone", "columns", ["danger", "warning"]),
    column_min_width: columnMinWidth,
  };

  // transitions
  const transRaw = requireObject(raw, "transitions", "root");
  const transitions: FlowBoardConfig["transitions"] = {
    mode: requireEnum(transRaw, "mode", "transitions", ["strict"]),
  };

  // empty
  const emptyRaw = requireObject(raw, "empty", "root");
  const empty: FlowBoardConfig["empty"] = {
    title: requireString(emptyRaw, "title", "empty"),
    body: requireString(emptyRaw, "body", "empty"),
  };

  return {
    name,
    title,
    description,
    panel,
    artefact_type_scope,
    exclude_prefixes,
    default_artefact_type_prefix,
    type_switcher,
    card,
    columns,
    transitions,
    empty,
  };
}

// ── Deep freeze ───────────────────────────────────────────────────────────────

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj as Readonly<T>;
}

// ── Public loader ─────────────────────────────────────────────────────────────

/**
 * Load and validate a FlowBoard sidecar config.
 *
 * @param raw - The imported JSON (typed as `unknown` to force validation).
 * @param override - Optional per-mount overrides merged on top of the validated
 *   config. Useful for samanthaAPI mounts that need a single field customised
 *   without forking the JSON sidecar.
 * @returns A deep-frozen `FlowBoardConfig`. Mutations on the returned object
 *   (or any nested sub-object) throw in strict mode and are no-ops in sloppy
 *   mode — the board always reads from its initial valid state.
 * @throws If `raw` is not a plain object, or any required key is missing or
 *   has the wrong type.
 */
export function loadFlowBoardConfig(
  raw: unknown,
  override?: Partial<FlowBoardConfig>
): Readonly<FlowBoardConfig> {
  if (!isObject(raw)) {
    throw new Error(
      `[FlowBoard loader] config must be a plain object — got ${JSON.stringify(raw)}`
    );
  }

  const validated = validateFlowBoardConfig(raw);

  // Shallow merge the override (top-level keys only, matching ObjectTreeV2 pattern).
  const merged: FlowBoardConfig = override
    ? { ...validated, ...override }
    : validated;

  return deepFreeze(merged);
}
