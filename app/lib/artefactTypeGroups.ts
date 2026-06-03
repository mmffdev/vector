import type { ArtefactType } from "@/app/lib/artefactTypesApi";

export type ArtefactTypeGroupKey = "execution" | "strategy";

export interface OrderedArtefactTypeGroup {
  key: ArtefactTypeGroupKey;
  label: string;
  types: ArtefactType[];
}

const EXECUTION_SLOT_ORDER = new Map<string, number>([
  ["wrk_epic", 10],
  ["wrk_story", 20],
  ["wrk_risk", 30],
  ["wrk_defect", 40],
  ["wrk_task", 50],
]);

function compareNames(a: ArtefactType, b: ArtefactType): number {
  return a.name.localeCompare(b.name);
}

function executionSlotRank(type: ArtefactType): number {
  return type.slot == null ? 20 : EXECUTION_SLOT_ORDER.get(type.slot) ?? 20;
}

function compareExecutionTypes(a: ArtefactType, b: ArtefactType): number {
  return (
    executionSlotRank(a) - executionSlotRank(b) ||
    a.sort_order - b.sort_order ||
    compareNames(a, b)
  );
}

function compareStrategyTypes(a: ArtefactType, b: ArtefactType): number {
  if (a.layer_depth != null && b.layer_depth != null) {
    return (
      a.layer_depth - b.layer_depth ||
      b.sort_order - a.sort_order ||
      compareNames(a, b)
    );
  }
  if (a.layer_depth != null) return -1;
  if (b.layer_depth != null) return 1;
  return b.sort_order - a.sort_order || compareNames(a, b);
}

export function buildOrderedArtefactTypeGroups(
  types: ArtefactType[],
): OrderedArtefactTypeGroup[] {
  const liveTypes = types.filter((type) => type.archived_at == null);
  const executionTypes = liveTypes
    .filter((type) => type.scope === "work")
    .sort(compareExecutionTypes);
  const strategyTypes = liveTypes
    .filter((type) => type.scope === "strategy")
    .sort(compareStrategyTypes);

  const groups: OrderedArtefactTypeGroup[] = [
    {
      key: "execution",
      label: "Execution Artefacts",
      types: executionTypes,
    },
    {
      key: "strategy",
      label: "Strategic Artefacts",
      types: strategyTypes,
    },
  ];
  return groups.filter((group) => group.types.length > 0);
}

export function flattenOrderedArtefactTypeGroups(
  groups: OrderedArtefactTypeGroup[],
): ArtefactType[] {
  return groups.flatMap((group) => group.types);
}
