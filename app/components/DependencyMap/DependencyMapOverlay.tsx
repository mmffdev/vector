"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  TbArrowLeft,
  TbArrowRight,
  TbArrowsShuffle,
  TbCheck,
  TbSearch,
  TbX,
} from "react-icons/tb";

import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import { FullscreenCanvasOverlay } from "@/app/components/FullscreenCanvasOverlay/FullscreenCanvasOverlay";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import {
  buildOrderedArtefactTypeGroups,
  type OrderedArtefactTypeGroup,
} from "@/app/lib/artefactTypeGroups";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";
import { workItems, type WorkItemQueryBody } from "@/app/lib/apiSite";
import { useSentinel } from "@/app/sentinel";
import type { SentinelGrant } from "@/app/sentinel/types";

export interface DependencyMapOverlayProps {
  artefact: ArtefactDetail;
  onClose: () => void;
}

interface DependencyMapMeta {
  artefactId: string;
  formattedId: string;
  title: string;
  itemType: string;
  typePrefix: string;
  keyNum: number;
  artefactTypeId: string;
  nodeId: string | null;
  nodeName: string;
  parentId: string | null;
  parentLabel: string | null;
  flowStateId: string;
  flowStateName: string;
  flowStateCode: string;
  ownerName: string;
}

type DependencyBucketKey = "requires" | "unlocks" | "parallel";
type DependencyCanvasVersion = "v1" | "v2";

type DependencyBucketForms = Record<DependencyBucketKey, DependencyBucketForm>;

interface DependencyCandidate {
  id: string;
  formattedId: string;
  title: string;
  typeLabel: string;
  nodeId: string | null;
}

interface WireDependencyCandidate {
  id: string;
  type_prefix: string;
  key_num: number;
  title: string;
  item_type: string;
  artefact_type_id: string;
  topology_node_id: string | null;
}

interface DependencyCandidateQuery {
  artefactId: string;
  search: string;
  selectedNodeId: string;
  selectedTypeId: string;
  sentinelGrants: readonly SentinelGrant[];
  typeOptions: DependencyTypeOption[];
}

interface DependencyBucketForm {
  selectedNodeId: string;
  selectedTypeId: string;
  search: string;
  candidateOptions: DependencyCandidate[];
  selectedCandidateIds: Set<string>;
}

interface DependencyTypeOption {
  value: string;
  label: string;
  slot: string | null;
  color?: string;
}

interface DependencyTypeGroup {
  label: string;
  options: DependencyTypeOption[];
}

function emptyBuckets(): Record<DependencyBucketKey, DependencyCandidate[]> {
  return {
    requires: [],
    unlocks: [],
    parallel: [],
  };
}

function emptyBucketSelections(): Record<DependencyBucketKey, Set<string>> {
  return {
    requires: new Set(),
    unlocks: new Set(),
    parallel: new Set(),
  };
}

function emptyBucketForms(nodeId: string, typeId = ""): DependencyBucketForms {
  return {
    requires: {
      selectedNodeId: nodeId,
      selectedTypeId: typeId,
      search: "",
      candidateOptions: [],
      selectedCandidateIds: new Set(),
    },
    unlocks: {
      selectedNodeId: nodeId,
      selectedTypeId: typeId,
      search: "",
      candidateOptions: [],
      selectedCandidateIds: new Set(),
    },
    parallel: {
      selectedNodeId: nodeId,
      selectedTypeId: typeId,
      search: "",
      candidateOptions: [],
      selectedCandidateIds: new Set(),
    },
  };
}

const BUCKETS: Array<{
  key: DependencyBucketKey;
  title: string;
  helper: string;
  icon: ReactNode;
  placeholder: string;
}> = [
  {
    key: "requires",
    title: "Requires First",
    helper: "Accepted before this can start",
    icon: <TbArrowLeft aria-hidden="true" />,
    placeholder: "Add prerequisite...",
  },
  {
    key: "unlocks",
    title: "Unlocks Next",
    helper: "Starts once this is done",
    icon: <TbArrowRight aria-hidden="true" />,
    placeholder: "Add dependent...",
  },
  {
    key: "parallel",
    title: "In Parallel",
    helper: "No gating, runs alongside",
    icon: <TbArrowsShuffle aria-hidden="true" />,
    placeholder: "Add parallel artefact...",
  },
];

const CANVAS_BUCKET_ORDER: DependencyBucketKey[] = [
  "requires",
  "parallel",
  "unlocks",
];

const DEPENDENCY_EXCLUDED_WORK_SLOTS = new Set(["wrk_task"]);
const DEPENDENCY_WORK_ITEM_SLOT = "wrk_story";
const DEPENDENCY_QUERY_LIMIT = 80;
const MAP_NODE_HEIGHT = 34;
const MAP_TARGET_HEIGHT = 34;
const MAP_NODE_GAP = 20;
const MAP_PARALLEL_MAX_COLUMNS = 1;
const MAP_CARD_INSET = 40;
const MAP_START_Y = 40;

interface DependencyMapFrame {
  width: number;
  height: number;
}

function formatArtefactId(artefact: ArtefactDetail): string {
  return `${artefact.type_prefix}-${artefact.key_num}`;
}

function grantLabel(grant: SentinelGrant): string {
  return grant.label_override ?? grant.name ?? grant.node_id;
}

function toDependencyTypeOption(type: ArtefactType): DependencyTypeOption {
  return {
    value: type.id,
    label: type.name,
    slot: type.slot,
    color: type.colour ?? undefined,
  };
}

function strategyRootTypeIds(groups: OrderedArtefactTypeGroup[]): Set<string> {
  const strategyTypes =
    groups.find((group) => group.key === "strategy")?.types ?? [];
  const topStrategyIds = new Set<string>();
  const strategyDepths = strategyTypes
    .map((type) => type.layer_depth)
    .filter((depth): depth is number => depth != null);

  if (strategyDepths.length > 0) {
    const topDepth = Math.min(...strategyDepths);
    strategyTypes
      .filter((type) => type.layer_depth === topDepth)
      .forEach((type) => topStrategyIds.add(type.id));
  } else if (strategyTypes.length > 0) {
    const topSortOrder = Math.max(...strategyTypes.map((type) => type.sort_order));
    strategyTypes
      .filter((type) => type.sort_order === topSortOrder)
      .forEach((type) => topStrategyIds.add(type.id));
  }

  return topStrategyIds;
}

function buildDependencyTypeGroups(
  groups: OrderedArtefactTypeGroup[],
): DependencyTypeGroup[] {
  const topStrategyIds = strategyRootTypeIds(groups);
  return groups
    .map((group) => ({
      label: group.label,
      options: group.types
        .filter((type) => {
          if (group.key === "execution") {
            return !DEPENDENCY_EXCLUDED_WORK_SLOTS.has(type.slot ?? "");
          }
          return !topStrategyIds.has(type.id);
        })
        .map(toDependencyTypeOption),
    }))
    .filter((group) => group.options.length > 0);
}

function dependencyCandidateBody(selectedTypeId: string): WorkItemQueryBody {
  const body: WorkItemQueryBody = {
    page: { limit: DEPENDENCY_QUERY_LIMIT, offset: 0 },
  };
  if (selectedTypeId) {
    body.filters = { itemTypeId: [selectedTypeId] };
  }
  return body;
}

async function fetchDependencyCandidates({
  artefactId,
  search,
  selectedNodeId,
  selectedTypeId,
  sentinelGrants,
  typeOptions,
}: DependencyCandidateQuery): Promise<DependencyCandidate[]> {
  const selectedNodeIds = selectedNodeId
    ? [selectedNodeId]
    : sentinelGrants.map((grant) => grant.node_id);
  const queryNodeIds =
    selectedNodeIds.length > 0 ? selectedNodeIds : [undefined];
  const byTypeId = new Map(typeOptions.map((type) => [type.value, type.label]));
  const needle = search.trim().toLowerCase();
  const seen = new Set<string>();
  const results = await Promise.all(
    queryNodeIds.map((nodeId) =>
      workItems.query(
        dependencyCandidateBody(selectedTypeId),
        nodeId ? { meg: nodeId } : undefined,
      ),
    ),
  );

  return results
    .flatMap((result) => result.items as WireDependencyCandidate[])
    .filter((item) => item.id !== artefactId)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => ({
      id: item.id,
      formattedId: `${item.type_prefix}-${item.key_num}`,
      title: item.title || "(untitled)",
      typeLabel: byTypeId.get(item.artefact_type_id) ?? item.item_type,
      nodeId: item.topology_node_id,
    }))
    .filter((item) => {
      if (!needle) return true;
      return (
        item.formattedId.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        item.typeLabel.toLowerCase().includes(needle)
      );
    });
}

export function DependencyMapOverlay({
  artefact,
  onClose,
}: DependencyMapOverlayProps) {
  const { sentinel_focus_node, sentinel_grants } = useSentinel();
  const { types: artefactTypes } = useArtefactTypeCatalogue();
  const nodeId = artefact.topology_node_id ?? sentinel_focus_node ?? null;
  const nodeGrant =
    nodeId == null
      ? null
      : sentinel_grants.find((grant) => grant.node_id === nodeId) ?? null;
  const nodeName = nodeGrant?.label_override ?? nodeGrant?.name ?? "This node";
  const formattedId = formatArtefactId(artefact);
  const artefactTitle = artefact.title || "(untitled)";
  const pageTitle = `${nodeName} — Dependency Map — ${formattedId} ${artefactTitle}`;
  const orderedTypeGroups = useMemo(
    () => buildOrderedArtefactTypeGroups(artefactTypes),
    [artefactTypes],
  );
  const typeOptionGroups = useMemo(
    () => buildDependencyTypeGroups(orderedTypeGroups),
    [orderedTypeGroups],
  );
  const typeOptions = useMemo(
    () => typeOptionGroups.flatMap((group) => group.options),
    [typeOptionGroups],
  );
  const defaultNodeId = nodeId ?? sentinel_focus_node ?? "";
  const defaultTypeId = useMemo(() => {
    const executionGroup = typeOptionGroups.find(
      (group) => group.label === "Execution Artefacts",
    );
    const executionOptions = executionGroup?.options ?? [];
    return (
      executionOptions.find((type) => type.slot === DEPENDENCY_WORK_ITEM_SLOT)
        ?.value ??
      executionOptions.find((type) => type.slot == null)?.value ??
      executionOptions[0]?.value ??
      ""
    );
  }, [typeOptionGroups]);
  const [canvasVersion, setCanvasVersion] =
    useState<DependencyCanvasVersion>("v1");
  const [activeBucket, setActiveBucket] =
    useState<DependencyBucketKey>("requires");
  const [filtersSeeded, setFiltersSeeded] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(defaultNodeId);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [candidateOptions, setCandidateOptions] = useState<DependencyCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [buckets, setBuckets] =
    useState<Record<DependencyBucketKey, DependencyCandidate[]>>(emptyBuckets);
  const [v2Buckets, setV2Buckets] =
    useState<Record<DependencyBucketKey, DependencyCandidate[]>>(emptyBuckets);
  const [selectedBucketItemIds, setSelectedBucketItemIds] = useState<
    Record<DependencyBucketKey, Set<string>>
  >(emptyBucketSelections);
  const [v2SelectedBucketItemIds, setV2SelectedBucketItemIds] = useState<
    Record<DependencyBucketKey, Set<string>>
  >(emptyBucketSelections);
  const [canvasForms, setCanvasForms] = useState<DependencyBucketForms>(() =>
    emptyBucketForms(defaultNodeId),
  );
  const [mapFrame, setMapFrame] = useState<DependencyMapFrame>({
    width: 1800,
    height: 720,
  });
  const mapViewportRef = useRef<HTMLElement>(null);

  const meta = useMemo<DependencyMapMeta>(
    () => ({
      artefactId: artefact.id,
      formattedId,
      title: artefactTitle,
      itemType: artefact.item_type,
      typePrefix: artefact.type_prefix,
      keyNum: artefact.key_num,
      artefactTypeId: artefact.artefact_type_id,
      nodeId,
      nodeName,
      parentId: artefact.parent_id,
      parentLabel: artefact.parent
        ? `${artefact.parent.type_prefix}-${artefact.parent.key_num} — ${artefact.parent.title}`
        : null,
      flowStateId: artefact.flow_state_id,
      flowStateName: artefact.flow_state_name,
      flowStateCode: artefact.flow_state_code,
      ownerName: artefact.owner?.display_name ?? "Unassigned",
    }),
    [artefact, artefactTitle, formattedId, nodeId, nodeName],
  );

  const appendCandidatesToBucket = (
    bucketKey: DependencyBucketKey,
    candidates: DependencyCandidate[],
    version: DependencyCanvasVersion = canvasVersion,
  ) => {
    if (candidates.length === 0) return;
    const setTargetBuckets = version === "v2" ? setV2Buckets : setBuckets;
    setTargetBuckets((prev) => {
      const existing = new Set(prev[bucketKey].map((item) => item.id));
      return {
        ...prev,
        [bucketKey]: [
          ...prev[bucketKey],
          ...candidates.filter((candidate) => !existing.has(candidate.id)),
        ],
      };
    });
  };

  const addCandidatesToBucket = (
    bucketKey: DependencyBucketKey,
    candidates: DependencyCandidate[],
  ) => {
    appendCandidatesToBucket(bucketKey, candidates, canvasVersion);
    setSelectedCandidateIds(new Set());
  };

  const addCanvasCandidatesToBucket = (bucketKey: DependencyBucketKey) => {
    const form = canvasForms[bucketKey];
    const candidates = form.candidateOptions.filter((candidate) =>
      form.selectedCandidateIds.has(candidate.id),
    );
    if (candidates.length === 0) return;
    appendCandidatesToBucket(bucketKey, candidates, "v1");
    setCanvasForms((prev) => ({
      ...prev,
      [bucketKey]: {
        ...prev[bucketKey],
        selectedCandidateIds: new Set(),
      },
    }));
  };

  const patchCanvasForm = (
    bucketKey: DependencyBucketKey,
    patch: Partial<Omit<DependencyBucketForm, "selectedCandidateIds">>,
  ) => {
    setCanvasForms((prev) => ({
      ...prev,
      [bucketKey]: {
        ...prev[bucketKey],
        ...patch,
      },
    }));
  };

  const toggleCanvasCandidate = (bucketKey: DependencyBucketKey, id: string) => {
    setCanvasForms((prev) => {
      const nextSelected = new Set(prev[bucketKey].selectedCandidateIds);
      if (nextSelected.has(id)) nextSelected.delete(id);
      else nextSelected.add(id);
      return {
        ...prev,
        [bucketKey]: {
          ...prev[bucketKey],
          selectedCandidateIds: nextSelected,
        },
      };
    });
  };

  const toggleBucketItem = (
    bucketKey: DependencyBucketKey,
    id: string,
    version: DependencyCanvasVersion = canvasVersion,
  ) => {
    const setSelected =
      version === "v2" ? setV2SelectedBucketItemIds : setSelectedBucketItemIds;
    setSelected((prev) => {
      const nextSet = new Set(prev[bucketKey]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...prev, [bucketKey]: nextSet };
    });
  };

  const removeSelectedFromBucket = (
    bucketKey: DependencyBucketKey,
    version: DependencyCanvasVersion = canvasVersion,
  ) => {
    const selectedMap =
      version === "v2" ? v2SelectedBucketItemIds : selectedBucketItemIds;
    const selectedIds = selectedMap[bucketKey];
    if (selectedIds.size === 0) return;
    const setTargetBuckets = version === "v2" ? setV2Buckets : setBuckets;
    const setSelected =
      version === "v2" ? setV2SelectedBucketItemIds : setSelectedBucketItemIds;
    setTargetBuckets((prev) => ({
      ...prev,
      [bucketKey]: prev[bucketKey].filter((item) => !selectedIds.has(item.id)),
    }));
    setSelected((prev) => ({ ...prev, [bucketKey]: new Set() }));
  };

  useEffect(() => {
    if (filtersSeeded) return;
    if (!defaultNodeId || !defaultTypeId) return;
    setSelectedNodeId(defaultNodeId);
    setSelectedTypeId(defaultTypeId);
    setCanvasForms(emptyBucketForms(defaultNodeId, defaultTypeId));
    setFiltersSeeded(true);
  }, [defaultNodeId, defaultTypeId, filtersSeeded]);

  useEffect(() => {
    if (!filtersSeeded) {
      setCandidateOptions([]);
      return;
    }
    let alive = true;
    fetchDependencyCandidates({
      artefactId: artefact.id,
      search,
      selectedNodeId,
      selectedTypeId,
      sentinelGrants: sentinel_grants,
      typeOptions,
    })
      .then((options) => {
        if (!alive) return;
        setCandidateOptions(options);
      })
      .catch(() => {
        if (alive) setCandidateOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [
    artefact.id,
    search,
    selectedNodeId,
    selectedTypeId,
    filtersSeeded,
    sentinel_grants,
    typeOptions,
  ]);

  const canvasFormQuerySignature = useMemo(
    () =>
      JSON.stringify(
        CANVAS_BUCKET_ORDER.map((bucketKey) => {
          const form = canvasForms[bucketKey];
          return [
            bucketKey,
            form.selectedNodeId,
            form.selectedTypeId,
            form.search,
          ];
        }),
      ),
    [canvasForms],
  );

  useEffect(() => {
    if (!filtersSeeded) return;
    let alive = true;
    Promise.all(
      CANVAS_BUCKET_ORDER.map(async (bucketKey) => {
        const form = canvasForms[bucketKey];
        const options = await fetchDependencyCandidates({
          artefactId: artefact.id,
          search: form.search,
          selectedNodeId: form.selectedNodeId,
          selectedTypeId: form.selectedTypeId,
          sentinelGrants: sentinel_grants,
          typeOptions,
        });
        return { bucketKey, options };
      }),
    )
      .then((results) => {
        if (!alive) return;
        setCanvasForms((prev) => {
          const next = { ...prev };
          results.forEach(({ bucketKey, options }) => {
            next[bucketKey] = {
              ...next[bucketKey],
              candidateOptions: options,
            };
          });
          return next;
        });
      })
      .catch(() => {
        if (!alive) return;
        setCanvasForms((prev) => {
          const next = { ...prev };
          CANVAS_BUCKET_ORDER.forEach((bucketKey) => {
            next[bucketKey] = {
              ...next[bucketKey],
              candidateOptions: [],
            };
          });
          return next;
        });
      });
    return () => {
      alive = false;
    };
  }, [
    artefact.id,
    canvasFormQuerySignature,
    filtersSeeded,
    sentinel_grants,
    typeOptions,
  ]);

  const selectedCandidates = useMemo(() => {
    return candidateOptions.filter((candidate) =>
      selectedCandidateIds.has(candidate.id),
    );
  }, [candidateOptions, selectedCandidateIds]);
  const activeBucketConfig =
    BUCKETS.find((bucket) => bucket.key === activeBucket) ?? BUCKETS[0];

  const renderTypeSelectOptions = () => (
    <>
      <option value="">All types</option>
      {typeOptionGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  const toggleCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderTargetCard = (placement: "canvas" | "sidebar") => (
    <section
      className={
        placement === "sidebar"
          ? "dependency-map__TargetCard dependency-map__TargetCard--sidebar"
          : "dependency-map__TargetCard"
      }
    >
      <span className="dependency-map__TargetEyebrow">
        Planning dependencies for
      </span>
      <div className="dependency-map__TargetMain">
        <input
          type="checkbox"
          className="dependency-composer__ResultCheckbox"
          readOnly
          aria-label={`${meta.formattedId} is the dependency map target`}
        />
        <strong className="dependency-map__TargetCode">
          {meta.formattedId}
        </strong>
        <span className="dependency-map__TargetTitle">{meta.title}</span>
        <span className="dependency-map__TargetStatus">
          {meta.flowStateName}
        </span>
      </div>
    </section>
  );

  const renderBucketRows = (
    bucketKey: DependencyBucketKey,
    items: DependencyCandidate[],
    version: DependencyCanvasVersion = canvasVersion,
  ) => {
    if (items.length === 0) {
      return (
        <span className="dependency-composer__BucketEmpty">
          Linked Artefacts
        </span>
      );
    }

    const selectedMap =
      version === "v2" ? v2SelectedBucketItemIds : selectedBucketItemIds;
    const selectedIds = selectedMap[bucketKey];
    return items.map((item) => {
      const selected = selectedIds.has(item.id);
      return (
      <label
        className={
          selected
            ? "dependency-composer__BucketRow is-selected"
            : "dependency-composer__BucketRow"
        }
        key={item.id}
      >
        <input
          type="checkbox"
          className="dependency-composer__ResultCheckbox"
          checked={selected}
          onChange={() => toggleBucketItem(bucketKey, item.id, version)}
          aria-label={`Select ${item.formattedId}`}
        />
        <span className="dependency-composer__BucketCode">
          {item.formattedId}
        </span>
        <span className="dependency-composer__BucketRowTitle">
          {item.title}
        </span>
      </label>
      );
    });
  };

  const renderCanvasForm = (bucketKey: DependencyBucketKey) => {
    const bucket = BUCKETS.find((item) => item.key === bucketKey) ?? BUCKETS[0];
    const form = canvasForms[bucketKey];
    const selectedCandidates = form.candidateOptions.filter((candidate) =>
      form.selectedCandidateIds.has(candidate.id),
    );

    return (
      <section className="dependency-composer__Form dependency-map__StateForm">
        <div className="dependency-composer__Filters">
          <select
            className="form__select dependency-composer__Select"
            value={form.selectedNodeId}
            onChange={(event) =>
              patchCanvasForm(bucketKey, { selectedNodeId: event.target.value })
            }
            aria-label={`${bucket.title} canvas node filter`}
          >
            <option value="">All visible nodes</option>
            {sentinel_grants.map((grant) => (
              <option key={grant.node_id} value={grant.node_id}>
                {grantLabel(grant)}
              </option>
            ))}
          </select>
          <select
            className="form__select dependency-composer__Select"
            value={form.selectedTypeId}
            onChange={(event) =>
              patchCanvasForm(bucketKey, { selectedTypeId: event.target.value })
            }
            aria-label={`${bucket.title} canvas type filter`}
          >
            {renderTypeSelectOptions()}
          </select>
        </div>

        <div className="dependency-composer__SearchRail">
          <span className="dependency-composer__SearchIcon" aria-hidden="true">
            <TbSearch />
          </span>
          <input
            type="search"
            className="dependency-composer__SearchInput"
            value={form.search}
            onChange={(event) =>
              patchCanvasForm(bucketKey, { search: event.target.value })
            }
            placeholder={bucket.placeholder}
            aria-label={`${bucket.title} canvas artefact search`}
          />
        </div>

        <div className="dependency-composer__Results">
          <div className="dependency-composer__ResultGroup">
            <span className="dependency-composer__ResultLabel">Artefacts</span>
            {form.candidateOptions.length === 0 ? (
              <div className="dependency-composer__ResultEmpty">
                No artefacts found
              </div>
            ) : (
              form.candidateOptions.map((candidate) => {
                const selected = form.selectedCandidateIds.has(candidate.id);
                return (
                  <label
                    key={candidate.id}
                    className={
                      selected
                        ? "dependency-composer__ResultRow is-selected"
                        : "dependency-composer__ResultRow"
                    }
                  >
                    <input
                      type="checkbox"
                      className="dependency-composer__ResultCheckbox"
                      checked={selected}
                      onChange={() => toggleCanvasCandidate(bucketKey, candidate.id)}
                      aria-label={`Select ${candidate.formattedId}`}
                    />
                    <span className="dependency-composer__ResultCode">
                      {candidate.formattedId}
                    </span>
                    <span className="dependency-composer__ResultTitle">
                      {candidate.title}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn btn--primary btn--sm dependency-composer__AddBtn"
          onClick={() => addCanvasCandidatesToBucket(bucketKey)}
          disabled={selectedCandidates.length === 0}
        >
          <TbCheck aria-hidden="true" />
          Add selected to {bucket.title}
        </button>
      </section>
    );
  };

  const renderCanvasBucket = (
    bucketKey: DependencyBucketKey,
    options?: {
      showForm?: boolean;
      showHelper?: boolean;
      showPayload?: boolean;
      version?: DependencyCanvasVersion;
    },
  ) => {
    const version = options?.version ?? "v1";
    const showForm = options?.showForm ?? true;
    const showHelper = options?.showHelper ?? true;
    const showPayload = options?.showPayload ?? true;
    const bucket = BUCKETS.find((item) => item.key === bucketKey) ?? BUCKETS[0];
    const items = version === "v2" ? v2Buckets[bucketKey] : buckets[bucketKey];
    const selectedMap =
      version === "v2" ? v2SelectedBucketItemIds : selectedBucketItemIds;

    return (
      <section className="dependency-map__StateBox" key={bucketKey}>
        <div className="dependency-composer__BucketHead">
          <span className="dependency-composer__BucketTitle">
            {bucket.icon}
            {bucket.title}
            <span className="dependency-composer__Count">{items.length}</span>
          </span>
          {showHelper ? (
            <p className="dependency-composer__BucketHelper">{bucket.helper}</p>
          ) : null}
        </div>

        <div
          className={`dependency-map__FlowChevron dependency-map__FlowChevron--${bucketKey}`}
          aria-hidden="true"
        >
          <span className="dependency-map__FlowChevron_Row dependency-map__FlowChevron_Row--top" />
          <span className="dependency-map__FlowChevron_Row dependency-map__FlowChevron_Row--bottom" />
          <span className="dependency-map__FlowChevron_Icon">{bucket.icon}</span>
        </div>

        {showForm ? renderCanvasForm(bucketKey) : null}

        {showPayload ? (
          <>
            <div className="dependency-composer__BucketRows">
              {renderBucketRows(bucketKey, items, version)}
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--sm dependency-composer__BucketAction"
              onClick={() => removeSelectedFromBucket(bucketKey, version)}
              disabled={selectedMap[bucketKey].size === 0}
            >
              <TbX aria-hidden="true" />
              Remove Artefact
            </button>
          </>
        ) : null}
      </section>
    );
  };

  const renderV2MapCard = (
    item: DependencyCandidate,
    x: number,
    y: number,
    width: number,
    tone: "requires" | "unlocks" | "parallel",
  ) => (
    <div
      key={item.id}
      className={`dependency-map__MapCard dependency-map__MapCard--${tone}`}
      style={
        {
          "--dependency-map-card-left": `${x}px`,
          "--dependency-map-card-top": `${y}px`,
          "--dependency-map-card-width": `${width}px`,
          "--dependency-map-card-height": `${MAP_NODE_HEIGHT}px`,
        } as CSSProperties
      }
      title={`${item.formattedId} ${item.title}`}
    >
      <span className="dependency-map__MapCard_Main">
        <strong className="dependency-map__MapCard_Code">
          {item.formattedId}
        </strong>
        <span className="dependency-map__MapCard_Title">{item.title}</span>
        <TbX className="dependency-map__MapCard_RemoveIcon" aria-hidden="true" />
      </span>
    </div>
  );

  const renderV2TargetCard = (x: number, y: number, width: number) => (
    <div
      className="dependency-map__MapCard dependency-map__MapCard--target"
      style={
        {
          "--dependency-map-card-left": `${x}px`,
          "--dependency-map-card-top": `${y}px`,
          "--dependency-map-card-width": `${width}px`,
          "--dependency-map-card-height": `${MAP_TARGET_HEIGHT}px`,
        } as CSSProperties
      }
      title={`${meta.formattedId} ${meta.title}`}
    >
      <span className="dependency-map__MapCard_Main">
        <strong className="dependency-map__MapCard_Code">
          {meta.formattedId}
        </strong>
        <span className="dependency-map__MapCard_Title">{meta.title}</span>
        <TbX className="dependency-map__MapCard_RemoveIcon" aria-hidden="true" />
      </span>
    </div>
  );

  const renderDependencyMapV2 = () => {
    const requires = v2Buckets.requires;
    const unlocks = v2Buckets.unlocks;
    const parallel = v2Buckets.parallel;
    const mapWidth = Math.max(1, mapFrame.width);
    const bucketColumnWidth = mapWidth / 3;
    const nodeWidth = Math.max(160, bucketColumnWidth - MAP_CARD_INSET);
    const targetWidth = nodeWidth;
    const parallelColumns =
      parallel.length === 0
        ? 1
        : Math.min(MAP_PARALLEL_MAX_COLUMNS, Math.ceil(Math.sqrt(parallel.length)));
    const parallelRows =
      parallel.length === 0 ? 0 : Math.ceil(parallel.length / parallelColumns);
    const parallelGroupHeight =
      parallelRows === 0
        ? 0
        : parallelRows * MAP_NODE_HEIGHT + (parallelRows - 1) * MAP_NODE_GAP;
    const sideCount = Math.max(requires.length, unlocks.length, 1);
    const sideGroupHeight =
      sideCount * MAP_NODE_HEIGHT + (sideCount - 1) * MAP_NODE_GAP;
    const requiresCenterX = bucketColumnWidth / 2;
    const parallelCenterX = mapWidth / 2;
    const unlocksCenterX = mapWidth - bucketColumnWidth / 2;
    const targetX = parallelCenterX - targetWidth / 2;
    const targetY = MAP_START_Y;
    const targetCenterX = targetX + targetWidth / 2;
    const targetCenterY = targetY + MAP_TARGET_HEIGHT / 2;
    const requiresX = requiresCenterX - nodeWidth / 2;
    const unlocksX = unlocksCenterX - nodeWidth / 2;
    const parallelStartX = parallelCenterX - nodeWidth / 2;
    const parallelStartY = targetY + MAP_TARGET_HEIGHT + MAP_NODE_GAP;
    const parallelBottomY =
      parallelRows === 0
        ? 0
        : parallelStartY + parallelGroupHeight + MAP_NODE_GAP * 2;
    const sideStartY = targetY;
    const mapHeight = Math.max(
      parallelBottomY + 80,
      sideStartY + sideGroupHeight + 80,
      mapFrame.height,
    );

    const sideY = (index: number) =>
      sideStartY + index * (MAP_NODE_HEIGHT + MAP_NODE_GAP);
    const parallelX = (index: number) =>
      parallelStartX +
      (index % parallelColumns) * (nodeWidth + MAP_NODE_GAP);
    const parallelY = (index: number) =>
      parallelStartY +
      Math.floor(index / parallelColumns) * (MAP_NODE_HEIGHT + MAP_NODE_GAP);
    const requiresLayout = requires.map((item, index) => ({
      item,
      x: requiresX,
      y: sideY(index),
    }));
    const unlocksLayout = unlocks.map((item, index) => ({
      item,
      x: unlocksX,
      y: sideY(index),
    }));
    const parallelLayout = parallel.map((item, index) => ({
      item,
      x: parallelX(index),
      y: parallelY(index),
    }));
    return (
      <section
        className="dependency-map__Graph"
        aria-label="V2 dependency map"
        ref={mapViewportRef}
      >
        <div
          className="dependency-map__GraphStage"
          style={
            {
              "--dependency-map-stage-width": `${mapWidth}px`,
              "--dependency-map-stage-height": `${mapHeight}px`,
              "--dependency-map-stage-left": "0px",
              "--dependency-map-stage-top": "0px",
            } as CSSProperties
          }
        >
          <svg
            className="dependency-map__GraphSvg"
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${meta.formattedId} dependency relationship map`}
          >
            <g className="dependency-map__Connectors" aria-hidden="true">
              {requiresLayout.map(({ item, x, y }) => {
                const centerY = y + MAP_NODE_HEIGHT / 2;
                return (
                  <path
                    key={`requires-${item.id}`}
                    d={`M ${x + nodeWidth} ${centerY} C ${x + nodeWidth + 80} ${centerY}, ${targetX - 80} ${targetCenterY}, ${targetX} ${targetCenterY}`}
                  />
                );
              })}
              {unlocksLayout.map(({ item, x, y }) => {
                const centerY = y + MAP_NODE_HEIGHT / 2;
                return (
                  <path
                    key={`unlocks-${item.id}`}
                    d={`M ${targetX + targetWidth} ${targetCenterY} C ${targetX + targetWidth + 80} ${targetCenterY}, ${x - 80} ${centerY}, ${x} ${centerY}`}
                  />
                );
              })}
              {parallelLayout.map(({ item, x, y }) => {
                const centerX = x + nodeWidth / 2;
                return (
                  <path
                    key={`parallel-${item.id}`}
                    d={`M ${targetCenterX} ${targetY + MAP_TARGET_HEIGHT} C ${targetCenterX} ${targetY + MAP_TARGET_HEIGHT + 52}, ${centerX} ${y - 52}, ${centerX} ${y}`}
                  />
                );
              })}
            </g>
          </svg>

          {requiresLayout.map(({ item, x, y }) =>
            renderV2MapCard(item, x, y, nodeWidth, "requires"),
          )}
          {unlocksLayout.map(({ item, x, y }) =>
            renderV2MapCard(item, x, y, nodeWidth, "unlocks"),
          )}
          {parallelLayout.map(({ item, x, y }) =>
            renderV2MapCard(item, x, y, nodeWidth, "parallel"),
          )}
          {renderV2TargetCard(targetX, targetY, targetWidth)}
        </div>
      </section>
    );
  };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [pageTitle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    if (canvasVersion !== "v2") return;
    const mapViewport = mapViewportRef.current;
    if (mapViewport == null) return;

    const measureMapFrame = () => {
      const viewportRect = mapViewport.getBoundingClientRect();
      setMapFrame({
        width: viewportRect.width,
        height: viewportRect.height,
      });
    };

    measureMapFrame();
    const observer = new ResizeObserver(measureMapFrame);
    observer.observe(mapViewport);
    window.addEventListener("resize", measureMapFrame);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureMapFrame);
    };
  }, [canvasVersion]);

  return (
    <FullscreenCanvasOverlay
      ariaLabel="Dependency map"
      title={pageTitle}
      subtitle={meta.title}
      status={{
        label: "Blank",
        tone: "new",
        ariaLabel: "Canvas state: blank",
      }}
      onClose={onClose}
      rootData={{
        "artefact-id": meta.artefactId,
        "artefact-code": meta.formattedId,
        "artefact-type-id": meta.artefactTypeId,
        "topology-node-id": meta.nodeId,
      }}
      canvasData={{
        "map-root-artefact-id": meta.artefactId,
        "map-root-artefact-code": meta.formattedId,
        "map-root-title": meta.title,
        "map-root-node-id": meta.nodeId,
      }}
      toolbar={
        <div className="dependency-map__Toolbar">
          <button
            type="button"
            className={
              canvasVersion === "v1"
                ? "fullscreen-canvas-overlay__Button is-active"
                : "fullscreen-canvas-overlay__Button fullscreen-canvas-overlay__Button--ghost"
            }
            onClick={() => setCanvasVersion("v1")}
            aria-pressed={canvasVersion === "v1"}
          >
            V1
          </button>
          <button
            type="button"
            className={
              canvasVersion === "v2"
                ? "fullscreen-canvas-overlay__Button is-active"
                : "fullscreen-canvas-overlay__Button fullscreen-canvas-overlay__Button--ghost"
            }
            onClick={() => setCanvasVersion("v2")}
            aria-pressed={canvasVersion === "v2"}
          >
            V2
          </button>
        </div>
      }
      sidebar={
        <div
          className={
            canvasVersion === "v2"
              ? "dependency-composer is-v2"
              : "dependency-composer"
          }
        >
          {canvasVersion === "v2" ? renderTargetCard("sidebar") : null}

          <nav
            className="dependency-composer__Mode"
            aria-label="Dependency relationship type"
          >
            {BUCKETS.map((bucket) => (
              <button
                key={bucket.key}
                type="button"
                className={
                  activeBucket === bucket.key
                    ? "dependency-composer__ModeBtn is-active"
                    : "dependency-composer__ModeBtn"
                }
                onClick={() => setActiveBucket(bucket.key)}
                aria-pressed={activeBucket === bucket.key}
              >
                {bucket.title}
              </button>
            ))}
          </nav>

          <section className="dependency-composer__Form">
            <div className="dependency-composer__Filters">
              <select
                className="form__select dependency-composer__Select"
                value={selectedNodeId}
                onChange={(event) => setSelectedNodeId(event.target.value)}
                aria-label={`${activeBucketConfig.title} node filter`}
              >
                <option value="">All visible nodes</option>
                {sentinel_grants.map((grant) => (
                  <option key={grant.node_id} value={grant.node_id}>
                    {grantLabel(grant)}
                  </option>
                ))}
              </select>
              <select
                className="form__select dependency-composer__Select"
                value={selectedTypeId}
                onChange={(event) => setSelectedTypeId(event.target.value)}
                aria-label={`${activeBucketConfig.title} type filter`}
              >
                {renderTypeSelectOptions()}
              </select>
            </div>

            <div className="dependency-composer__SearchRail">
              <span
                className="dependency-composer__SearchIcon"
                aria-hidden="true"
              >
                <TbSearch />
              </span>
              <input
                type="search"
                className="dependency-composer__SearchInput"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeBucketConfig.placeholder}
                aria-label={`${activeBucketConfig.title} artefact search`}
              />
            </div>

            <div className="dependency-composer__Results">
              <div className="dependency-composer__ResultGroup">
                <span className="dependency-composer__ResultLabel">
                  Artefacts
                </span>
                {candidateOptions.length === 0 ? (
                  <div className="dependency-composer__ResultEmpty">
                    No artefacts found
                  </div>
                ) : (
                  candidateOptions.map((candidate) => {
                    const selected = selectedCandidateIds.has(candidate.id);
                    return (
                      <label
                        key={candidate.id}
                        className={
                          selected
                            ? "dependency-composer__ResultRow is-selected"
                            : "dependency-composer__ResultRow"
                        }
                      >
                        <input
                          type="checkbox"
                          className="dependency-composer__ResultCheckbox"
                          checked={selected}
                          onChange={() => toggleCandidate(candidate.id)}
                          aria-label={`Select ${candidate.formattedId}`}
                        />
                        <span className="dependency-composer__ResultCode">
                          {candidate.formattedId}
                        </span>
                        <span className="dependency-composer__ResultTitle">
                          {candidate.title}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--sm dependency-composer__AddBtn"
              onClick={() => addCandidatesToBucket(activeBucket, selectedCandidates)}
              disabled={selectedCandidates.length === 0}
            >
              <TbCheck aria-hidden="true" />
              Add selected to {activeBucketConfig.title}
            </button>
          </section>

          {canvasVersion === "v1" ? BUCKETS.map((bucket) => {
            const items = buckets[bucket.key];
            const active = bucket.key === activeBucket;
            return (
              <section
                className={
                  active
                    ? "dependency-composer__Bucket is-active"
                    : "dependency-composer__Bucket"
                }
                key={bucket.key}
              >
                <div className="dependency-composer__BucketHead">
                  <span className="dependency-composer__BucketTitle">
                    {bucket.icon}
                    {bucket.title}
                    <span className="dependency-composer__Count">
                      {items.length}
                    </span>
                  </span>
                  <p className="dependency-composer__BucketHelper">
                    {bucket.helper}
                  </p>
                </div>

                <div className="dependency-composer__BucketRows">
                  {renderBucketRows(bucket.key, items)}
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm dependency-composer__BucketAction"
                  onClick={() => removeSelectedFromBucket(bucket.key)}
                  disabled={selectedBucketItemIds[bucket.key].size === 0}
                >
                  <TbX aria-hidden="true" />
                  Remove Artefact
                </button>
              </section>
            );
          }) : null}

          {canvasVersion === "v1" ? <section className="dependency-composer__Meta">
            <div className="dependency-composer__MetaRow">
              <span className="dependency-composer__MetaLabel">Node</span>
              <span>{meta.nodeName}</span>
            </div>
            <div className="dependency-composer__MetaRow">
              <span className="dependency-composer__MetaLabel">Parent</span>
              <span>{meta.parentLabel ?? "No parent"}</span>
            </div>
            <div className="dependency-composer__MetaRow">
              <span className="dependency-composer__MetaLabel">Owner</span>
              <span>{meta.ownerName}</span>
            </div>
          </section> : null}
        </div>
      }
    >
      <div
        className={
          canvasVersion === "v2"
            ? "dependency-map__Canvas dependency-map__Canvas--v2"
            : "dependency-map__Canvas"
        }
      >
        {canvasVersion === "v1" ? renderTargetCard("canvas") : null}

        <div className="dependency-map__StateGrid">
          {CANVAS_BUCKET_ORDER.map((bucketKey) =>
            renderCanvasBucket(bucketKey, {
              showForm: canvasVersion === "v1",
              showHelper: canvasVersion === "v1",
              showPayload: canvasVersion === "v1",
              version: canvasVersion,
            }),
          )}
        </div>
        {canvasVersion === "v2" ? renderDependencyMapV2() : null}
      </div>
    </FullscreenCanvasOverlay>
  );
}
