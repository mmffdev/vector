// Samantha SDK — in-product API surface for custom-app authors.
//
// This file is the runtime root of `samantha.*`. Keep the namespace
// shape append-only — every release bumps a sub-surface version
// independently of the others, so a v1 contract MUST stay
// source-compatible until v2 is published.
//
// Sub-surfaces currently registered: (none — the prior
// samantha.diagram.canvas v1 surface was retired when the in-house
// canvas was replaced by @xyflow/react. Custom-app authors should
// import @xyflow/react directly until a thin Samantha re-export is
// re-introduced.)
//
// Sub-surfaces documented but not yet runtime-bound:
//
//   samantha.portfolio.fields (planned) — see docs/c_samantha_sdk_fields.md.

export const samantha = {};

export default samantha;
