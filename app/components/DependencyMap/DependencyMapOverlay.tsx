"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
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

const EMPTY_BUCKETS: Record<DependencyBucketKey, DependencyCandidate[]> = {
  requires: [],
  unlocks: [],
  parallel: [],
};

function emptyBucketSelections(): Record<DependencyBucketKey, Set<string>> {
  return {
    requires: new Set(),
    unlocks: new Set(),
    parallel: new Set(),
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

function formatArtefactId(artefact: ArtefactDetail): string {
  return `${artefact.type_prefix}-${artefact.key_num}`;
}

function grantLabel(grant: SentinelGrant): string {
  return grant.label_override ?? grant.name ?? grant.node_id;
}

export function DependencyMapOverlay({
  artefact,
  onClose,
}: DependencyMapOverlayProps) {
  const { sentinel_focus_node, sentinel_grants } = useSentinel();
  const workTypeOptions = useChipTypeOptions("work");
  const strategyTypeOptions = useChipTypeOptions("strategy");
  const nodeId = artefact.topology_node_id ?? sentinel_focus_node ?? null;
  const nodeGrant =
    nodeId == null
      ? null
      : sentinel_grants.find((grant) => grant.node_id === nodeId) ?? null;
  const nodeName = nodeGrant?.label_override ?? nodeGrant?.name ?? "This node";
  const formattedId = formatArtefactId(artefact);
  const artefactTitle = artefact.title || "(untitled)";
  const pageTitle = `${nodeName} — Dependency Map — ${formattedId} ${artefactTitle}`;
  const typeOptions = useMemo(
    () => [...strategyTypeOptions, ...workTypeOptions],
    [strategyTypeOptions, workTypeOptions],
  );
  const [activeBucket, setActiveBucket] =
    useState<DependencyBucketKey>("requires");
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodeId ?? "");
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [candidateOptions, setCandidateOptions] = useState<DependencyCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [buckets, setBuckets] =
    useState<Record<DependencyBucketKey, DependencyCandidate[]>>(EMPTY_BUCKETS);
  const [selectedBucketItemIds, setSelectedBucketItemIds] = useState<
    Record<DependencyBucketKey, Set<string>>
  >(emptyBucketSelections);

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
    let alive = true;
    const body: WorkItemQueryBody = { page: { limit: 40, offset: 0 } };
    if (selectedTypeId) {
      body.filters = { itemTypeId: [selectedTypeId] };
    }
    workItems
      .query(body)
      .then((result) => {
        if (!alive) return;
        const needle = search.trim().toLowerCase();
        const byTypeId = new Map(typeOptions.map((type) => [type.value, type.label]));
        const options = (result.items as WireDependencyCandidate[])
          .filter((item) => item.id !== artefact.id)
          .filter((item) => !selectedNodeId || item.topology_node_id === selectedNodeId)
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
        setCandidateOptions(options.slice(0, 12));
      })
      .catch(() => {
        if (alive) setCandidateOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [artefact.id, search, selectedNodeId, selectedTypeId, typeOptions]);

  const selectedCandidates = useMemo(() => {
    return candidateOptions.filter((candidate) =>
      selectedCandidateIds.has(candidate.id),
    );
  }, [candidateOptions, selectedCandidateIds]);
  const activeBucketConfig =
    BUCKETS.find((bucket) => bucket.key === activeBucket) ?? BUCKETS[0];

  const toggleCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderBucketRows = (
    bucketKey: DependencyBucketKey,
    items: DependencyCandidate[],
  ) => {
    if (items.length === 0) {
      return (
        <span className="dependency-composer__BucketEmpty">
          No artefacts added
        </span>
      );
    }

    const selectedIds = selectedBucketItemIds[bucketKey];
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
          onChange={() => toggleBucketItem(bucketKey, item.id)}
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
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
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

          {BUCKETS.map((bucket) => {
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
          })}

          <section className="dependency-composer__Meta">
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
          </section>
        </div>
      }
    >
      <div className="fullscreen-canvas-overlay__Canvas_Empty dependency-map__CanvasPlaceholder">
        <p>{meta.formattedId} is loaded as the root artefact.</p>
      </div>
    </FullscreenCanvasOverlay>
  );
}
