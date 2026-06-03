"use client";

import {
  useEffect,
  useMemo,
  useState,
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
import {
  milestones as milestonesApi,
  releases as releasesApi,
  sprints as sprintsApi,
  workItems,
  type WorkItemQueryBody,
} from "@/app/lib/apiSite";
import {
  nodeRelativeTimeboxParams,
  resolveWorkspaceId,
} from "@/app/components/ArtefactInlineForm/timeboxOptions";
import { useSentinel } from "@/app/sentinel";
import type { SentinelGrant } from "@/app/sentinel/types";
import { usePersistedDependencyMap } from "@/app/components/DependencyMap/usePersistedDependencyMap";

export interface DependencyMapOverlayProps {
  artefact: ArtefactDetail;
  onClose: () => void;
  /**
   * PLA074 / B23.2.4 — when supplied, the composer wires its bucket
   * state to the backend dependencies service via
   * `usePersistedDependencyMap`. Without it, the composer falls back
   * to ephemeral React-only buckets (the legacy preview path).
   * Plumbed in by `app/(user)/dependencies/page.tsx` from a `?mid=`
   * URL param once a map-picker UX lands.
   */
  mapId?: string | null;
}

interface DependencyMapMeta {
  artefactId: string;
  formattedId: string;
  title: string;
  artefactTypeId: string;
  nodeId: string | null;
}

type DependencyBucketKey = "requires" | "unlocks" | "parallel";

interface DependencyCandidate {
  id: string;
  formattedId: string;
  title: string;
  typeLabel: string;
  nodeId: string | null;
  description: string;
  sprintId: string | null;
  sprintLabel: string | null;
  releaseId: string | null;
  milestoneId: string | null;
}

interface WireDependencyCandidate {
  id: string;
  type_prefix: string;
  key_num: number;
  title: string;
  item_type: string;
  artefact_type_id: string;
  topology_node_id: string | null;
  description: string | null;
  // Wire shape pinned by backend/internal/artefactitems/types.go: sprint_id
  // is the FK string; the nested `sprint` object carries the alias when the
  // sprint row resolves. SQL aliases the columns as sprint_ref_id /
  // sprint_ref_alias internally — those are NOT the JSON keys.
  sprint_id: string | null;
  sprint: { id: string; alias: string } | null;
  release_id: string | null;
  milestone_id: string | null;
}

interface DependencyCandidateQuery {
  artefactId: string;
  search: string;
  selectedNodeId: string;
  selectedTypeId: string;
  selectedSprintId: string;
  selectedReleaseId: string;
  selectedMilestoneId: string;
  sentinelGrants: readonly SentinelGrant[];
  typeOptions: DependencyTypeOption[];
}

interface TimeboxOption {
  value: string;
  label: string;
  isCurrent: boolean;
}

const TIMEBOX_NONE = "__none__";

function isCurrentInRange(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start && !end) return false;
  const today = new Date().toISOString().slice(0, 10);
  const afterStart = start ? today >= start : true;
  const beforeEnd = end ? today <= end : true;
  return afterStart && beforeEnd;
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

// Ordered left-to-right by the logical dependency flow: things that
// must finish first → things that can run alongside → things that
// unlock after. The mode tabs in the sidebar and the chevron lanes
// in the canvas both iterate this in order, so they always agree.
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
    key: "parallel",
    title: "In Parallel",
    helper: "No gating, runs alongside",
    icon: <TbArrowsShuffle aria-hidden="true" />,
    placeholder: "Add parallel artefact...",
  },
  {
    key: "unlocks",
    title: "Unlocks Next",
    helper: "Starts once this is done",
    icon: <TbArrowRight aria-hidden="true" />,
    placeholder: "Add dependent...",
  },
];

const CANVAS_BUCKET_ORDER: DependencyBucketKey[] = BUCKETS.map((b) => b.key);

const DEPENDENCY_EXCLUDED_WORK_SLOTS = new Set(["wrk_task"]);
const DEPENDENCY_WORK_ITEM_SLOT = "wrk_story";
const DEPENDENCY_QUERY_LIMIT = 80;

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
  if (selectedTypeId) body.filters = { itemTypeId: [selectedTypeId] };
  return body;
}

// Three AND-chained timebox filters. ANY (empty string) means the filter
// doesn't contribute; specific id means equality; TIMEBOX_NONE means the
// dimension must be null. A row passes only when EVERY active dimension
// matches — ANY dimensions are skipped. When all three are ANY, the row
// passes by default.
function matchTimeboxDimension(
  candidateValue: string | null,
  selected: string,
): boolean {
  // Selected is empty string when the dropdown is on ANY — the caller
  // should already have short-circuited on that, but we guard anyway so a
  // stale empty value can't reject every row.
  if (!selected) return true;
  if (selected === TIMEBOX_NONE) return candidateValue == null;
  return candidateValue === selected;
}

function passesTimeboxFilters(
  candidate: DependencyCandidate,
  selectedSprintId: string,
  selectedReleaseId: string,
  selectedMilestoneId: string,
): boolean {
  if (selectedSprintId && !matchTimeboxDimension(candidate.sprintId, selectedSprintId)) {
    return false;
  }
  if (selectedReleaseId && !matchTimeboxDimension(candidate.releaseId, selectedReleaseId)) {
    return false;
  }
  if (selectedMilestoneId && !matchTimeboxDimension(candidate.milestoneId, selectedMilestoneId)) {
    return false;
  }
  return true;
}


async function fetchDependencyCandidates({
  artefactId,
  search,
  selectedNodeId,
  selectedTypeId,
  selectedSprintId,
  selectedReleaseId,
  selectedMilestoneId,
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
    .map<DependencyCandidate>((item) => ({
      id: item.id,
      formattedId: `${item.type_prefix}-${item.key_num}`,
      title: item.title || "(untitled)",
      typeLabel: byTypeId.get(item.artefact_type_id) ?? item.item_type,
      nodeId: item.topology_node_id,
      description: (item.description ?? "").trim(),
      sprintId: item.sprint_id,
      sprintLabel: item.sprint?.alias ?? null,
      releaseId: item.release_id,
      milestoneId: item.milestone_id,
    }))
    .filter((candidate) =>
      passesTimeboxFilters(
        candidate,
        selectedSprintId,
        selectedReleaseId,
        selectedMilestoneId,
      ),
    )
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
  mapId = null,
}: DependencyMapOverlayProps) {
  // PLA074 / B23.2.4 — persistence wire. When `mapId` is present
  // (page passes it from `?mid=`), the hook GETs the three-bucket
  // projection from /_site/dependencies/edges on mount and exposes
  // add/remove handlers that POST to the backend. The composer's
  // existing ephemeral `buckets` state below remains the source of
  // truth for the legacy preview path; the persisted state is a
  // parallel signal until the composer's full state model is
  // rewritten on top of the hook. The hook's return is intentionally
  // read into a side-effecting void so React's effect cascade hydrates
  // the persisted state — composer rendering integration is a follow-up
  // (deferred per Vector_Scope.md B23.2.4 note).
  const persisted = usePersistedDependencyMap({
    mapId,
    focusedArtefactId: artefact.id,
  });
  void persisted;
  const { sentinel_focus_node, sentinel_grants, sentinel_user } = useSentinel();
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
  const [activeBucket, setActiveBucket] =
    useState<DependencyBucketKey>("requires");
  const [filtersSeeded, setFiltersSeeded] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(defaultNodeId);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>("");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>("");
  const [sprintOptions, setSprintOptions] = useState<TimeboxOption[]>([]);
  const [releaseOptions, setReleaseOptions] = useState<TimeboxOption[]>([]);
  const [milestoneOptions, setMilestoneOptions] = useState<TimeboxOption[]>([]);
  const [search, setSearch] = useState("");
  const [candidateOptions, setCandidateOptions] = useState<DependencyCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [buckets, setBuckets] =
    useState<Record<DependencyBucketKey, DependencyCandidate[]>>(emptyBuckets);
  const [selectedBucketItemIds, setSelectedBucketItemIds] = useState<
    Record<DependencyBucketKey, Set<string>>
  >(emptyBucketSelections);

  const meta = useMemo<DependencyMapMeta>(
    () => ({
      artefactId: artefact.id,
      formattedId,
      title: artefactTitle,
      artefactTypeId: artefact.artefact_type_id,
      nodeId,
    }),
    [artefact, artefactTitle, formattedId, nodeId],
  );

  const addCandidatesToBucket = (
    bucketKey: DependencyBucketKey,
    candidates: DependencyCandidate[],
  ) => {
    if (candidates.length === 0) return;
    setBuckets((prev) => {
      const existing = new Set(prev[bucketKey].map((item) => item.id));
      return {
        ...prev,
        [bucketKey]: [
          ...prev[bucketKey],
          ...candidates.filter((candidate) => !existing.has(candidate.id)),
        ],
      };
    });
    setSelectedCandidateIds(new Set());
  };

  const toggleBucketItem = (bucketKey: DependencyBucketKey, id: string) => {
    setSelectedBucketItemIds((prev) => {
      const nextSet = new Set(prev[bucketKey]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...prev, [bucketKey]: nextSet };
    });
  };

  const removeSelectedFromBucket = (bucketKey: DependencyBucketKey) => {
    const selectedIds = selectedBucketItemIds[bucketKey];
    if (selectedIds.size === 0) return;
    setBuckets((prev) => ({
      ...prev,
      [bucketKey]: prev[bucketKey].filter((item) => !selectedIds.has(item.id)),
    }));
    setSelectedBucketItemIds((prev) => ({ ...prev, [bucketKey]: new Set() }));
  };

  useEffect(() => {
    if (filtersSeeded) return;
    if (!defaultNodeId || !defaultTypeId) return;
    setSelectedNodeId(defaultNodeId);
    setSelectedTypeId(defaultTypeId);
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
      selectedSprintId,
      selectedReleaseId,
      selectedMilestoneId,
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
    selectedSprintId,
    selectedReleaseId,
    selectedMilestoneId,
    filtersSeeded,
    sentinel_grants,
    typeOptions,
  ]);

  // The timebox endpoints key off the tenant id, NOT the grant's
  // workspace_id — even though the param is named `workspace_id` on the
  // wire (legacy contract pinned by `resolveWorkspaceId` in
  // ArtefactInlineForm/timeboxOptions.ts). Resolving via the shared helper
  // keeps the dependency-map composer aligned with the inline-form fetch.
  const timeboxWorkspaceId = useMemo(
    () =>
      resolveWorkspaceId(
        sentinel_user?.tenant_id,
        sentinel_user?.workspace_id,
        sentinel_grants,
        selectedNodeId || sentinel_focus_node,
      ),
    [sentinel_user, sentinel_grants, selectedNodeId, sentinel_focus_node],
  );

  useEffect(() => {
    if (!timeboxWorkspaceId || !selectedNodeId) {
      setSprintOptions([]);
      setReleaseOptions([]);
      setMilestoneOptions([]);
      return;
    }
    let alive = true;
    const params = nodeRelativeTimeboxParams(timeboxWorkspaceId, selectedNodeId);
    Promise.all([
      sprintsApi.list(params).catch(() => ({ items: [] })),
      releasesApi.list(params).catch(() => ({ items: [] })),
      milestonesApi.list(params).catch(() => ({ milestones: [] })),
    ]).then(([sprintsRes, releasesRes, milestonesRes]) => {
      if (!alive) return;
      const sprintItems = (sprintsRes as { items: unknown[] }).items ?? [];
      const releaseItems = (releasesRes as { items: unknown[] }).items ?? [];
      const milestoneItems =
        (milestonesRes as { milestones: unknown[] }).milestones ?? [];
      setSprintOptions(
        sprintItems
          .map((raw) => {
            const row = raw as Record<string, unknown>;
            const id = row.timeboxes_sprints_id;
            const name = row.timeboxes_sprints_name;
            if (typeof id !== "string" || typeof name !== "string") return null;
            const suffix = row.timeboxes_sprints_suffix;
            const label =
              typeof suffix === "string" && suffix.trim()
                ? `${name} - ${suffix.trim()}`
                : name;
            return {
              value: id,
              label,
              isCurrent: isCurrentInRange(
                row.timeboxes_sprints_date_start as string | null,
                row.timeboxes_sprints_date_end as string | null,
              ),
            };
          })
          .filter((opt): opt is TimeboxOption => opt !== null),
      );
      setReleaseOptions(
        releaseItems
          .map((raw) => {
            const row = raw as Record<string, unknown>;
            const id = row.timeboxes_releases_id;
            const name = row.timeboxes_releases_name;
            if (typeof id !== "string" || typeof name !== "string") return null;
            const suffix = row.timeboxes_releases_suffix;
            const label =
              typeof suffix === "string" && suffix.trim()
                ? `${name} - ${suffix.trim()}`
                : name;
            return {
              value: id,
              label,
              isCurrent: isCurrentInRange(
                row.timeboxes_releases_date_start as string | null,
                row.timeboxes_releases_date_end as string | null,
              ),
            };
          })
          .filter((opt): opt is TimeboxOption => opt !== null),
      );
      setMilestoneOptions(
        milestoneItems
          .map((raw) => {
            const row = raw as Record<string, unknown>;
            const id = row.timeboxes_milestones_id;
            const name = row.timeboxes_milestones_name;
            if (typeof id !== "string" || typeof name !== "string") return null;
            // Milestones are point-in-time markers — no "current window".
            return { value: id, label: name, isCurrent: false };
          })
          .filter((opt): opt is TimeboxOption => opt !== null),
      );
    });
    return () => {
      alive = false;
    };
  }, [timeboxWorkspaceId, selectedNodeId]);

  // Drop stale timebox selections whenever the node scope shifts — a
  // sprint/release/milestone id is only meaningful within its source node.
  useEffect(() => {
    setSelectedSprintId("");
    setSelectedReleaseId("");
    setSelectedMilestoneId("");
  }, [selectedNodeId]);

  const selectedCandidates = useMemo(() => {
    return candidateOptions.filter((candidate) =>
      selectedCandidateIds.has(candidate.id),
    );
  }, [candidateOptions, selectedCandidateIds]);

  // Backend currently denormalises only the sprint alias on each work item
  // (sprint: { id, alias }). Release and milestone come back as IDs only,
  // so look up the human name client-side from the catalogs we already
  // fetch for the dropdowns. Names resolve when the candidate's timebox
  // belongs to the selected node; when it doesn't (or no node is picked)
  // we fall back to "Assigned" so the user still knows the field is set.
  // Proper fix is backend denormalisation — flagged for follow-up.
  const releaseLabelById = useMemo(() => {
    const map = new Map<string, string>();
    releaseOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [releaseOptions]);
  const milestoneLabelById = useMemo(() => {
    const map = new Map<string, string>();
    milestoneOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [milestoneOptions]);
  const labelForReleaseId = (id: string | null) =>
    id == null ? "—" : releaseLabelById.get(id) ?? "Assigned";
  const labelForMilestoneId = (id: string | null) =>
    id == null ? "—" : milestoneLabelById.get(id) ?? "Assigned";
  const pillClass = (assigned: boolean) =>
    `dependency-composer__ResultPill ${assigned ? "is-assigned" : "is-unassigned"}`;
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

  const renderTargetCard = () => {
    const description = (artefact.description ?? "").trim();
    return (
      <section className="dependency-map__TargetCard">
        <span className="dependency-map__TargetEyebrow">
          Planning dependencies for
        </span>
        <div className="dependency-map__TargetBody">
          <span className="dependency-composer__ResultHead">
            <span className="dependency-composer__ResultCode">
              {meta.formattedId}
            </span>
            <span className="dependency-composer__ResultTitle">
              {meta.title}
            </span>
          </span>
          <span className="dependency-composer__ResultDescription">
            {description || "No description"}
          </span>
          <span className="dependency-composer__ResultMeta">
            <span className={pillClass(artefact.sprint?.alias != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Sprint
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {artefact.sprint?.alias ?? "—"}
              </span>
            </span>
            <span className={pillClass(artefact.release_id != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Release
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {labelForReleaseId(artefact.release_id)}
              </span>
            </span>
            <span className={pillClass(artefact.milestone_id != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Milestone
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {labelForMilestoneId(artefact.milestone_id)}
              </span>
            </span>
          </span>
        </div>
      </section>
    );
  };

  const renderBucketRows = (
    bucketKey: DependencyBucketKey,
    items: DependencyCandidate[],
  ) => {
    if (items.length === 0) {
      return (
        <span className="dependency-composer__BucketEmpty">
          Linked Artefacts
        </span>
      );
    }

    const selectedIds = selectedBucketItemIds[bucketKey];
    return items.map((item) => {
      const selected = selectedIds.has(item.id);
      return (
        <button
          key={item.id}
          type="button"
          className={
            selected
              ? "dependency-composer__BucketRow is-selected"
              : "dependency-composer__BucketRow"
          }
          onClick={() => toggleBucketItem(bucketKey, item.id)}
          aria-pressed={selected}
          aria-label={`${selected ? "Deselect" : "Select"} ${item.formattedId}`}
        >
          <span className="dependency-composer__ResultHead">
            <span className="dependency-composer__BucketCode">
              {item.formattedId}
            </span>
            <span className="dependency-composer__BucketRowTitle">
              {item.title}
            </span>
          </span>
          <span className="dependency-composer__ResultDescription">
            {item.description || "No description"}
          </span>
          <span className="dependency-composer__ResultMeta">
            <span className={pillClass(item.sprintLabel != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Sprint
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {item.sprintLabel ?? "—"}
              </span>
            </span>
            <span className={pillClass(item.releaseId != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Release
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {labelForReleaseId(item.releaseId)}
              </span>
            </span>
            <span className={pillClass(item.milestoneId != null)}>
              <span className="dependency-composer__ResultPill_Label">
                Milestone
              </span>
              <span className="dependency-composer__ResultPill_Value">
                {labelForMilestoneId(item.milestoneId)}
              </span>
            </span>
          </span>
        </button>
      );
    });
  };

  // Shared chevron block — used both by the canvas lanes (`renderCanvasBucket`
  // below) and by the mode tabs in the sidebar so they animate the same way.
  // `withIcon` is opt-in: canvas lanes show the icon badge; mode tabs hide it
  // because the button itself overlays a centred label pill.
  const renderFlowChevron = (
    bucketKey: DependencyBucketKey,
    options: { isActive: boolean; withIcon: boolean; icon?: ReactNode },
  ) => {
    const isParallel = bucketKey === "parallel";
    const rows = (
      <>
        <span className="dependency-map__FlowChevron_Row dependency-map__FlowChevron_Row--top" />
        <span className="dependency-map__FlowChevron_Row dependency-map__FlowChevron_Row--bottom" />
      </>
    );
    return (
      <div
        className={`dependency-map__FlowChevron dependency-map__FlowChevron--${bucketKey}${options.isActive ? " is-active" : ""}`}
        aria-hidden="true"
      >
        {isParallel ? (
          <div className="dependency-map__FlowChevron_Pair">{rows}</div>
        ) : (
          rows
        )}
        {options.withIcon && options.icon ? (
          <span className="dependency-map__FlowChevron_Icon">{options.icon}</span>
        ) : null}
      </div>
    );
  };

  const renderCanvasBucket = (bucketKey: DependencyBucketKey) => {
    const bucket = BUCKETS.find((item) => item.key === bucketKey) ?? BUCKETS[0];
    const items = buckets[bucketKey];
    const isActive = bucketKey === activeBucket;

    return (
      <section className="dependency-map__StateBox" key={bucketKey}>
        <div className="dependency-composer__BucketHead">
          <span className="dependency-composer__BucketTitle">
            {bucket.icon}
            {bucket.title}
            <span className="dependency-composer__Count">{items.length}</span>
          </span>
          <p className="dependency-composer__BucketHelper">{bucket.helper}</p>
        </div>

        {renderFlowChevron(bucketKey, {
          isActive,
          withIcon: true,
          icon: bucket.icon,
        })}

        <div className="dependency-composer__BucketRows">
          {renderBucketRows(bucketKey, items)}
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm dependency-composer__BucketAction"
          onClick={() => removeSelectedFromBucket(bucketKey)}
          disabled={selectedBucketItemIds[bucketKey].size === 0}
        >
          <TbX aria-hidden="true" />
          Remove Artefact
        </button>
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
      sidebar={
        <div className="dependency-composer">
          {renderTargetCard()}

          <nav
            className="dependency-composer__Mode"
            aria-label="Dependency relationship type"
          >
            {BUCKETS.map((bucket) => {
              const isActive = activeBucket === bucket.key;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={
                    isActive
                      ? "dependency-composer__ModeBtn is-active"
                      : "dependency-composer__ModeBtn"
                  }
                  onClick={() => setActiveBucket(bucket.key)}
                  aria-pressed={isActive}
                >
                  {renderFlowChevron(bucket.key, {
                    isActive,
                    withIcon: false,
                  })}
                  <span className="dependency-composer__ModeBtn_Label">
                    {bucket.title}
                  </span>
                </button>
              );
            })}
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

            <div className="dependency-composer__Filters dependency-composer__Filters--timebox">
              <select
                className="form__select dependency-composer__Select"
                value={selectedSprintId}
                onChange={(event) => setSelectedSprintId(event.target.value)}
                disabled={!selectedNodeId}
                aria-label={`${activeBucketConfig.title} sprint filter`}
              >
                <option value="">
                  {selectedNodeId ? "ANY sprint" : "Sprint (pick a node)"}
                </option>
                <option value={TIMEBOX_NONE}>No sprint assigned</option>
                {sprintOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.isCurrent ? `★ ${option.label}` : option.label}
                  </option>
                ))}
              </select>
              <select
                className="form__select dependency-composer__Select"
                value={selectedReleaseId}
                onChange={(event) => setSelectedReleaseId(event.target.value)}
                disabled={!selectedNodeId}
                aria-label={`${activeBucketConfig.title} release filter`}
              >
                <option value="">
                  {selectedNodeId ? "ANY release" : "Release (pick a node)"}
                </option>
                <option value={TIMEBOX_NONE}>No release assigned</option>
                {releaseOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.isCurrent ? `★ ${option.label}` : option.label}
                  </option>
                ))}
              </select>
              <select
                className="form__select dependency-composer__Select"
                value={selectedMilestoneId}
                onChange={(event) => setSelectedMilestoneId(event.target.value)}
                disabled={!selectedNodeId}
                aria-label={`${activeBucketConfig.title} milestone filter`}
              >
                <option value="">
                  {selectedNodeId ? "ANY milestone" : "Milestone (pick a node)"}
                </option>
                <option value={TIMEBOX_NONE}>No milestone assigned</option>
                {milestoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
                      <button
                        key={candidate.id}
                        type="button"
                        className={
                          selected
                            ? "dependency-composer__ResultRow is-selected"
                            : "dependency-composer__ResultRow"
                        }
                        onClick={() => toggleCandidate(candidate.id)}
                        aria-pressed={selected}
                        aria-label={`${selected ? "Deselect" : "Select"} ${candidate.formattedId}`}
                      >
                        <span className="dependency-composer__ResultHead">
                          <span className="dependency-composer__ResultCode">
                            {candidate.formattedId}
                          </span>
                          <span className="dependency-composer__ResultTitle">
                            {candidate.title}
                          </span>
                        </span>
                        <span className="dependency-composer__ResultDescription">
                          {candidate.description || "No description"}
                        </span>
                        <span className="dependency-composer__ResultMeta">
                          <span className={pillClass(candidate.sprintLabel != null)}>
                            <span className="dependency-composer__ResultPill_Label">
                              Sprint
                            </span>
                            <span className="dependency-composer__ResultPill_Value">
                              {candidate.sprintLabel ?? "—"}
                            </span>
                          </span>
                          <span className={pillClass(candidate.releaseId != null)}>
                            <span className="dependency-composer__ResultPill_Label">
                              Release
                            </span>
                            <span className="dependency-composer__ResultPill_Value">
                              {labelForReleaseId(candidate.releaseId)}
                            </span>
                          </span>
                          <span className={pillClass(candidate.milestoneId != null)}>
                            <span className="dependency-composer__ResultPill_Label">
                              Milestone
                            </span>
                            <span className="dependency-composer__ResultPill_Value">
                              {labelForMilestoneId(candidate.milestoneId)}
                            </span>
                          </span>
                        </span>
                      </button>
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
        </div>
      }
    >
      <div className="dependency-map__Canvas">
        <div className="dependency-map__StateGrid">
          {CANVAS_BUCKET_ORDER.map((bucketKey) => renderCanvasBucket(bucketKey))}
        </div>
      </div>
    </FullscreenCanvasOverlay>
  );
}
