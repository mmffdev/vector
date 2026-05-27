// cytoscape-dagre ships no types and has no @types package. The codebase
// only uses its default export — a cytoscape extension that gets handed
// to `cytoscape.use(...)`. Typing as `cytoscape.Ext` matches what `.use()`
// expects exactly (it's an opaque extension factory the cytoscape side
// inspects internally).
import type cytoscape from "cytoscape";
declare module "cytoscape-dagre" {
  const ext: cytoscape.Ext;
  export default ext;
}
