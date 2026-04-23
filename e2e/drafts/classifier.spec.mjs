// Pure-rule tests for the form-draft field classifier.
//
// These shadow the rules in `app/lib/draftClassifier.ts` rather than
// importing it (no TS runner in this test harness). Keep the SENSITIVE
// list and branching here in sync with that module — if a token is
// added/removed there, mirror it here. Code review enforces parity.

import { test } from "node:test";
import assert from "node:assert/strict";

const SENSITIVE = new Set([
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

function classify({ type, autocomplete, dataNoDraft }) {
  if (dataNoDraft) return { draftable: false, reason: "data-no-draft" };
  const t = (type ?? "").toLowerCase();
  if (t === "password") return { draftable: false, reason: "password-type" };
  if (t === "hidden") return { draftable: false, reason: "hidden-type" };
  const ac = (autocomplete ?? "").toLowerCase().trim();
  if (ac) {
    for (const tok of ac.split(/\s+/)) {
      if (SENSITIVE.has(tok)) return { draftable: false, reason: "sensitive-autocomplete" };
    }
  }
  return { draftable: true };
}

test("plain text input is draftable", () => {
  assert.equal(classify({ type: "text" }).draftable, true);
});

test("textarea is draftable", () => {
  assert.equal(classify({ type: null }).draftable, true);
});

test("password type is rejected", () => {
  const r = classify({ type: "password" });
  assert.equal(r.draftable, false);
  assert.equal(r.reason, "password-type");
});

test("hidden type is rejected", () => {
  assert.equal(classify({ type: "hidden" }).draftable, false);
});

test("data-no-draft opt-out is rejected", () => {
  const r = classify({ type: "text", dataNoDraft: true });
  assert.equal(r.draftable, false);
  assert.equal(r.reason, "data-no-draft");
});

for (const tok of [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
]) {
  test(`autocomplete=${tok} is rejected`, () => {
    const r = classify({ type: "text", autocomplete: tok });
    assert.equal(r.draftable, false, `${tok} must not be draftable`);
    assert.equal(r.reason, "sensitive-autocomplete");
  });
}

test("multi-token autocomplete rejects when ANY token is sensitive", () => {
  const r = classify({ type: "text", autocomplete: "section-billing cc-number" });
  assert.equal(r.draftable, false);
});

test("benign autocomplete tokens pass", () => {
  assert.equal(classify({ type: "text", autocomplete: "username" }).draftable, true);
  assert.equal(classify({ type: "text", autocomplete: "name given-name" }).draftable, true);
});

test("autocomplete is matched case-insensitively", () => {
  assert.equal(classify({ type: "text", autocomplete: "CC-NUMBER" }).draftable, false);
});
