// Field classifier — decides whether a single form field is safe to draft.
// Default-deny posture: any field whose `autocomplete` token signals a
// secret or one-shot value is excluded. Custom components opt out with
// `data-no-draft`.
//
// Pure (no DOM dependency) so it can be unit-tested under `node --test`.
// Pass a plain shape; the React caller adapts an HTMLElement into it.

const SENSITIVE_AUTOCOMPLETE = new Set<string>([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-type",
]);

export interface FieldShape {
  type?: string | null;          // <input type="...">
  autocomplete?: string | null;  // first token of the `autocomplete` attribute
  dataNoDraft?: boolean;         // `data-no-draft` present (any value)
  tag?: string | null;           // "input" | "textarea" | "select" | custom
}

export interface ClassifyResult {
  draftable: boolean;
  reason?: "password-type" | "sensitive-autocomplete" | "data-no-draft" | "hidden-type";
}

export function classifyField(f: FieldShape): ClassifyResult {
  if (f.dataNoDraft) return { draftable: false, reason: "data-no-draft" };

  const type = (f.type ?? "").toLowerCase();
  if (type === "password") return { draftable: false, reason: "password-type" };
  if (type === "hidden") return { draftable: false, reason: "hidden-type" };

  // `autocomplete` may be a space-separated token list (e.g. "section-foo cc-number").
  // Any token that is sensitive disqualifies the field.
  const ac = (f.autocomplete ?? "").toLowerCase().trim();
  if (ac) {
    for (const token of ac.split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE.has(token)) {
        return { draftable: false, reason: "sensitive-autocomplete" };
      }
    }
  }

  return { draftable: true };
}

// Convenience for callers that hold an HTMLElement. Kept thin so the pure
// classifier above can be unit-tested without a DOM.
export function classifyElement(el: HTMLElement): ClassifyResult {
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type ?? null;
  const autocomplete = el.getAttribute("autocomplete");
  const dataNoDraft = el.hasAttribute("data-no-draft");
  return classifyField({ tag, type, autocomplete, dataNoDraft });
}

export const __SENSITIVE_AUTOCOMPLETE = SENSITIVE_AUTOCOMPLETE;
