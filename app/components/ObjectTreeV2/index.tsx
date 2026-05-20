// ObjectTree — generic hierarchical resource tree primitive.
// Exports the main component and related types for pluggable data-type configuration.

export { default } from "./p_ObjectTree";
export type { ObjectTreeDataConfig } from "./p_ObjectTree";
export type { WorkItem } from "@/app/components/work-items-tree-config";
export {
  objectTreeRegistry,
  registerObjectTreeConfig,
  getObjectTreeConfig,
  type ObjectTreeConfig,
} from "./p_ObjectTreeRegistry";
