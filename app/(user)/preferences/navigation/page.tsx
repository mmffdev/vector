"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PageShell from "@/app/components/PageShell";
import { NavIcon } from "@/app/components/NavIcon";
import ProfileBar, { MAX_PROFILES } from "@/app/components/ProfileBar";
import InlineEditField from "@/app/components/InlineEditField";
import { useAuth } from "@/app/contexts/AuthContext";
import {
  useNavPrefs,
  type NavCatalogEntry,
  type PutPrefsBody,
  type PutPrefsPinnedRow,
  type PutPrefsGroupRow,
} from "@/app/contexts/NavPrefsContext";
import { createCustomPage, patchCustomPage, deleteCustomPage } from "@/app/lib/customPages";
import { ApiError } from "@/app/lib/api";
import { useDraft } from "@/app/hooks/useDraft";

const MAX_PINNED = 50;
const MAX_CUSTOM_GROUPS = 10;
const MAX_CHILDREN_PER_PARENT = 8;
const MAX_GROUP_LABEL_LEN = 64;
const MAX_CUSTOM_PAGES = 50;

// A bucket id is either "tag:<enum>" for a system tag bucket or
// "group:<id>" for a custom group bucket. Custom groups can be reordered;
// system tags stay where they are. Catalogue (non user_custom) items always
// sit in their tag bucket; only user_custom items can move into custom
// groups or nest under a parent.
type BucketKey = string;
const tagBucket = (e: string): BucketKey => `tag:${e}`;
const groupBucket = (id: string): BucketKey => `group:${id}`;

interface DraftItem {
  key: string;
  parent: string | null;
}

interface DraftGroup {
  id: string; // canonical UUID, or "new:<uuid>" for unsaved
  label: string;
  position: number;
}

interface DraftState {
  // bucketOrder is the visual top-to-bottom order of all buckets; it
  // includes both tag and custom buckets interleaved by user choice.
  bucketOrder: BucketKey[];
  // itemsByBucket: top-level items in each bucket, in render order.
  // children are stored separately keyed by parent.
  itemsByBucket: Record<BucketKey, DraftItem[]>;
  childrenByParent: Record<string, string[]>; // parentKey -> ordered child keys
  customGroups: DraftGroup[];
  startPageKey: string | null;
  // Per-item icon override; missing key means "use catalogue default".
  iconOverrides: Record<string, string>;
}

// Icons the user can pick. Mirrors the cases in app/components/NavIcon.tsx
// (excluding "default", which is the fallback the catalogue can't choose).
const ICON_CHOICES: string[] = [
  "home", "eye", "briefcase", "star", "clipboard", "list",
  "warning", "cog", "wrench", "pin", "folder", "package", "pencil",
];

const itemDragId = (k: string) => `item:${k}`;
const groupHeaderDragId = (id: string) => `gheader:${id}`;

function nextSyntheticId(): string {
  return `new:${typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)}`;
}

// Inter-group drop slot — only rendered while a group header is being
// dragged. Gives the user a clear, generously-sized drop target between
// every pair of groups (and one above the first / below the last) so
// reordering doesn't depend on hitting the next group's header.
function GroupDropSlot({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${index}` });
  return (
    <div
      ref={setNodeRef}
      className={`nav-prefs__slot${isOver ? " nav-prefs__slot--over" : ""}`}
      aria-hidden="true"
    />
  );
}

// Small badge shown next to seeded (catalogue, non user_custom) nav items
// to explain why rename/delete are unavailable. Hover shows a native
// tooltip; click toggles an inline popover.
function CoreItemBadge({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="nav-prefs__core-badge">
      <button
        type="button"
        className="nav-prefs__btn nav-prefs__btn--core"
        aria-label={`${label} is a core menu item`}
        aria-expanded={open}
        title="Core menu item — cannot be renamed"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => setOpen(false)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {open && (
        <span className="nav-prefs__core-popover" role="tooltip">
          This is a core menu item and cannot be renamed.
        </span>
      )}
    </span>
  );
}

// Inline delete-confirm tail. Renders at the right end of an actions row;
// existing buttons shift left as this expands the actions container.
function DeleteConfirm({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="nav-prefs__confirm" role="group" aria-label={`Confirm delete ${label}`}>
      <span className="nav-prefs__confirm-text">Delete?</span>
      <button
        type="button"
        className="nav-prefs__btn nav-prefs__btn--confirm"
        onClick={(e) => { e.stopPropagation(); onConfirm(); }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Confirm delete ${label}`}
        title="Confirm delete"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
      <button
        type="button"
        className="nav-prefs__btn"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Cancel delete"
        title="Cancel"
      >×</button>
    </span>
  );
}

function PinnedRow({
  entry,
  iconKey,
  isStart,
  onUnpin,
  onToggleStart,
  onPickIcon,
  onRenameCustom,
  onDeleteCustom,
  draggable,
}: {
  entry: NavCatalogEntry;
  iconKey: string;
  isStart: boolean;
  onUnpin: () => void;
  onToggleStart: () => void;
  onPickIcon?: () => void;
  onRenameCustom?: (label: string) => void;
  onDeleteCustom?: () => void;
  draggable: boolean;
}) {
  const sortable = useSortable({ id: itemDragId(entry.key), disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isCustom = entry.kind === "user_custom";
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <li ref={setNodeRef} style={style} className={`nav-prefs__row${isCustom ? " nav-prefs__row--user-custom" : ""}`}>
      {draggable && (
        <button
          type="button"
          className="nav-prefs__drag"
          aria-label={`Reorder ${entry.label}`}
          title="Drag to reorder or nest"
          {...attributes}
          {...listeners}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      )}
      <span className="nav-prefs__row-icon" aria-hidden="true">
        <NavIcon iconKey={iconKey} />
      </span>
      {isCustom && onRenameCustom ? (
        <InlineEditField
          value={entry.label}
          onCommit={onRenameCustom}
          ariaLabel={`Rename ${entry.label}`}
          inputClassName="nav-prefs__label-rename"
          displayClassName="nav-prefs__label"
          editing={renaming}
          onEditingChange={setRenaming}
        />
      ) : (
        <span className="nav-prefs__label">{entry.label}</span>
      )}
      <div className="nav-prefs__actions">
        {!isCustom && <CoreItemBadge label={entry.label} />}
        {isCustom && !renaming && onRenameCustom && (
          <button
            type="button"
            className="nav-prefs__btn"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${entry.label}`}
            title="Rename"
          >✎</button>
        )}
        {isCustom && onDeleteCustom && (
          <button
            type="button"
            className="nav-prefs__btn nav-prefs__btn--danger"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${entry.label}`}
            title="Delete page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </button>
        )}
        {onPickIcon && (
          <button
            type="button"
            className="nav-prefs__btn"
            onClick={onPickIcon}
            aria-label={`Change icon for ${entry.label}`}
            title="Change icon"
          >
            <NavIcon iconKey={iconKey} />
          </button>
        )}
        <button
          type="button"
          className={`nav-prefs__btn ${isStart ? "nav-prefs__btn--active" : ""}`}
          onClick={onToggleStart}
          aria-label={isStart ? `Unset ${entry.label} as start page` : `Set ${entry.label} as start page`}
          aria-pressed={isStart}
          title={isStart ? "Start page (click to unset)" : "Set as start page"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
        </button>
        <button
          type="button"
          className="nav-prefs__btn nav-prefs__btn--danger"
          onClick={onUnpin}
          aria-label={`Unpin ${entry.label}`}
          title="Unpin"
        >×</button>
        {confirmingDelete && onDeleteCustom && (
          <DeleteConfirm
            label={entry.label}
            onConfirm={() => { onDeleteCustom(); setConfirmingDelete(false); }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </li>
  );
}

// Inline icon picker shown directly under the row that opened it.
function IconPicker({
  currentIcon,
  hasOverride,
  onChoose,
  onClear,
  onClose,
}: {
  currentIcon: string;
  hasOverride: boolean;
  onChoose: (icon: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="nav-prefs__picker" role="group" aria-label="Select Icon">
      <span className="nav-prefs__picker-label">Select Icon</span>
      <div className="nav-prefs__picker-grid">
        {ICON_CHOICES.map((ic) => (
          <button
            key={ic}
            type="button"
            className={`nav-prefs__picker-btn ${ic === currentIcon ? "nav-prefs__picker-btn--active" : ""}`}
            aria-label={`Use ${ic} icon`}
            aria-pressed={ic === currentIcon}
            title={ic}
            onClick={() => { onChoose(ic); onClose(); }}
          >
            <NavIcon iconKey={ic} />
          </button>
        ))}
      </div>
      <div className="nav-prefs__picker-actions">
        {hasOverride && onClear && (
          <button
            type="button"
            className="nav-prefs__btn"
            onClick={() => { onClear(); onClose(); }}
            title="Use the default icon for this page"
          >Reset</button>
        )}
        <button
          type="button"
          className="nav-prefs__btn"
          onClick={onClose}
          aria-label="Close icon picker"
        >Close</button>
      </div>
    </div>
  );
}

// Children list shown beneath a parent when expanded.
function ChildrenList({
  parentKey,
  childKeys,
  startPageKey,
  findEntry,
  iconOverrides,
  pickerKey,
  onUnpin,
  onToggleStart,
  onPickIcon,
  onSetIcon,
  onClearIcon,
  onRenameCustom,
  onDeleteCustom,
}: {
  parentKey: string;
  childKeys: string[];
  startPageKey: string | null;
  findEntry: (k: string) => NavCatalogEntry | undefined;
  iconOverrides: Record<string, string>;
  pickerKey: string | null;
  onUnpin: (k: string) => void;
  onToggleStart: (k: string) => void;
  onPickIcon?: (k: string) => void;
  onSetIcon?: (k: string, icon: string) => void;
  onClearIcon?: (k: string) => void;
  onRenameCustom?: (k: string, label: string) => void;
  onDeleteCustom?: (k: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `parent:${parentKey}` });
  return (
    <ul
      ref={setNodeRef}
      className={`nav-prefs__children ${isOver ? "nav-prefs__children--over" : ""}`}
    >
      <SortableContext items={childKeys.map(itemDragId)} strategy={verticalListSortingStrategy}>
        {childKeys.map((ck) => {
          const e = findEntry(ck);
          if (!e) return null;
          const ik = iconOverrides[ck] ?? e.icon;
          return (
            <Fragment key={ck}>
              <PinnedRow
                entry={e}
                iconKey={ik}
                isStart={startPageKey === ck}
                onUnpin={() => onUnpin(ck)}
                onToggleStart={() => onToggleStart(ck)}
                onPickIcon={onPickIcon ? () => onPickIcon(ck) : undefined}
                onRenameCustom={onRenameCustom ? (label) => onRenameCustom(ck, label) : undefined}
                onDeleteCustom={onDeleteCustom ? () => onDeleteCustom(ck) : undefined}
                draggable
              />
              {pickerKey === ck && onSetIcon && (
                <li className="nav-prefs__picker-row">
                  <IconPicker
                    currentIcon={ik}
                    hasOverride={ck in iconOverrides}
                    onChoose={(icon) => onSetIcon(ck, icon)}
                    onClear={onClearIcon ? () => onClearIcon(ck) : undefined}
                    onClose={() => onPickIcon && onPickIcon(ck)}
                  />
                </li>
              )}
            </Fragment>
          );
        })}
      </SortableContext>
      <li className="nav-prefs__children-empty">Drag a custom page here to nest it.</li>
    </ul>
  );
}

// A single bucket (tag or custom) — sortable list of items + nested children.
function BucketBlock({
  bucketId,
  heading,
  items,
  childrenByParent,
  startPageKey,
  findEntry,
  iconOverrides,
  pickerKey,
  onUnpin,
  onToggleStart,
  onPickIcon,
  onSetIcon,
  onClearIcon,
  onRename,
  onRemoveGroup,
  onRenameCustom,
  onDeleteCustom,
  isCustom,
}: {
  bucketId: BucketKey;
  heading: string;
  items: DraftItem[];
  childrenByParent: Record<string, string[]>;
  startPageKey: string | null;
  findEntry: (k: string) => NavCatalogEntry | undefined;
  iconOverrides: Record<string, string>;
  pickerKey: string | null;
  onUnpin: (k: string) => void;
  onToggleStart: (k: string) => void;
  onPickIcon?: (k: string) => void;
  onSetIcon?: (k: string, icon: string) => void;
  onClearIcon?: (k: string) => void;
  onRename?: (label: string) => void;
  onRemoveGroup?: () => void;
  onRenameCustom?: (key: string, label: string) => void;
  onDeleteCustom?: (key: string) => void;
  isCustom: boolean;
}) {
  const headerSortable = useSortable({
    id: groupHeaderDragId(bucketId),
  });
  const dropZone = useDroppable({ id: `bucket:${bucketId}` });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(headerSortable.transform),
    transition: headerSortable.transition,
    opacity: headerSortable.isDragging ? 0.6 : 1,
  };

  const [editing, setEditing] = useState(false);

  return (
    <div
      ref={headerSortable.setNodeRef}
      style={style}
      className={`nav-prefs__group ${isCustom ? "nav-prefs__group--custom" : ""}`}
    >
      <div className="nav-prefs__group-heading-row">
        <button
          type="button"
          className="nav-prefs__group-drag"
          aria-label={`Reorder ${heading} group`}
          title="Drag group to reorder"
          {...headerSortable.attributes}
          {...headerSortable.listeners}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        {isCustom && onRename ? (
          editing ? (
            <InlineEditField
              value={heading}
              onCommit={onRename}
              ariaLabel={`Rename ${heading} group`}
              inputClassName="nav-prefs__group-rename"
              displayClassName="nav-prefs__group-heading"
              maxLength={MAX_GROUP_LABEL_LEN}
              editing={editing}
              onEditingChange={setEditing}
            />
          ) : (
            <h3
              className="nav-prefs__group-heading"
              onDoubleClick={() => setEditing(true)}
              title="Double-click to rename"
            >
              {heading}
            </h3>
          )
        ) : (
          <h3 className="nav-prefs__group-heading">{heading}</h3>
        )}
        {isCustom && !editing && (
          <div className="nav-prefs__group-actions">
            <button
              type="button"
              className="nav-prefs__btn"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${heading} group`}
              title="Rename group"
            >✎</button>
            <button
              type="button"
              className="nav-prefs__btn nav-prefs__btn--danger"
              onClick={onRemoveGroup}
              aria-label={`Remove ${heading} group`}
              title="Remove group (items move to their tag groups)"
            >×</button>
          </div>
        )}
      </div>
      <SortableContext items={items.map((it) => itemDragId(it.key))} strategy={verticalListSortingStrategy}>
        <ul
          ref={dropZone.setNodeRef}
          className={`nav-prefs__list ${dropZone.isOver ? "nav-prefs__list--over" : ""}`}
        >
          {items.length === 0 && (
            <li className="nav-prefs__children-empty">
              {isCustom ? "Drag a custom page here." : "Drag here, or pin something below."}
            </li>
          )}
          {items.map((it) => {
            const entry = findEntry(it.key);
            if (!entry) return null;
            const childKeys = childrenByParent[it.key] ?? [];
            const ik = iconOverrides[it.key] ?? entry.icon;
            // All top-level items can be reordered. Catalogue items are
            // locked to their tag bucket / can't be nested — onDragEnd
            // enforces that, but they still drag-sort within their bucket.
            return (
              <div key={it.key} className="nav-prefs__parent-wrap">
                <PinnedRow
                  entry={entry}
                  iconKey={ik}
                  isStart={startPageKey === it.key}
                  onUnpin={() => onUnpin(it.key)}
                  onToggleStart={() => onToggleStart(it.key)}
                  onPickIcon={onPickIcon ? () => onPickIcon(it.key) : undefined}
                  onRenameCustom={onRenameCustom ? (label) => onRenameCustom(it.key, label) : undefined}
                  onDeleteCustom={onDeleteCustom ? () => onDeleteCustom(it.key) : undefined}
                  draggable
                />
                {pickerKey === it.key && onSetIcon && (
                  <IconPicker
                    currentIcon={ik}
                    hasOverride={it.key in iconOverrides}
                    onChoose={(icon) => onSetIcon(it.key, icon)}
                    onClear={onClearIcon ? () => onClearIcon(it.key) : undefined}
                    onClose={() => onPickIcon && onPickIcon(it.key)}
                  />
                )}
                <ChildrenList
                  parentKey={it.key}
                  childKeys={childKeys}
                  startPageKey={startPageKey}
                  findEntry={findEntry}
                  iconOverrides={iconOverrides}
                  pickerKey={pickerKey}
                  onUnpin={onUnpin}
                  onToggleStart={onToggleStart}
                  onPickIcon={onPickIcon}
                  onSetIcon={onSetIcon}
                  onClearIcon={onClearIcon}
                  onRenameCustom={onRenameCustom}
                  onDeleteCustom={onDeleteCustom}
                />
              </div>
            );
          })}
        </ul>
      </SortableContext>
    </div>
  );
}

function AvailablePanel({
  poolTags,
  poolByTag,
  libraryEntries,
  atCap,
  customPagesTotal,
  onPin,
  onRenameCustom,
  onDeleteCustom,
  onSetPoolIcon,
}: {
  poolTags: import("@/app/contexts/NavPrefsContext").NavTagGroup[];
  poolByTag: Map<string, import("@/app/contexts/NavPrefsContext").NavCatalogEntry[]>;
  libraryEntries: import("@/app/contexts/NavPrefsContext").NavCatalogEntry[];
  atCap: boolean;
  customPagesTotal: number;
  onPin: (key: string) => void;
  onRenameCustom: (key: string, label: string) => void;
  onDeleteCustom: (key: string) => void;
  onSetPoolIcon: (key: string, icon: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool:available" });
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const togglePicker = (k: string) => setPickerKey((cur) => (cur === k ? null : k));
  const renderItem = (entry: import("@/app/contexts/NavPrefsContext").NavCatalogEntry) => (
    <Fragment key={entry.key}>
      <PoolItem
        entry={entry}
        atCap={atCap}
        onPin={onPin}
        onRenameCustom={entry.kind === "user_custom" ? (label) => onRenameCustom(entry.key, label) : undefined}
        onDeleteCustom={entry.kind === "user_custom" ? () => onDeleteCustom(entry.key) : undefined}
        onPickIcon={entry.kind === "user_custom" ? () => togglePicker(entry.key) : undefined}
      />
      {pickerKey === entry.key && (
        <li className="nav-prefs__picker-row">
          <IconPicker
            currentIcon={entry.icon}
            hasOverride={false}
            onChoose={(icon) => { onSetPoolIcon(entry.key, icon); setPickerKey(null); }}
            onClose={() => setPickerKey(null)}
          />
        </li>
      )}
    </Fragment>
  );
  const empty = poolTags.length === 0 && libraryEntries.length === 0;
  return (
    <section
      ref={setNodeRef}
      className={`nav-prefs__pane nav-prefs__pane--available${isOver ? " nav-prefs__pane--drop-target" : ""}`}
      aria-label="Available"
    >
      <header className="nav-prefs__pane-header">
        <h2 className="nav-prefs__pane-title">
          Available <span className="nav-prefs__count">{customPagesTotal}/{MAX_CUSTOM_PAGES}</span>
        </h2>
      </header>
      {empty ? (
        <p className="nav-prefs__empty">Everything visible to your role is already pinned.</p>
      ) : (
        <>
          <div className="nav-prefs__group nav-prefs__group--library">
            <div className="nav-prefs__group-heading-row">
              <h3 className="nav-prefs__group-heading">Library</h3>
            </div>
            {libraryEntries.length === 0 ? (
              <p className="nav-prefs__empty nav-prefs__empty--library">
                Custom pages you create live here. Drag them into Pinned to add them to your sidebar.
              </p>
            ) : (
              <ul className="nav-prefs__list">{libraryEntries.map(renderItem)}</ul>
            )}
          </div>
          {poolTags.map((tag) => (
            <div key={tag.enum} className="nav-prefs__group">
              <div className="nav-prefs__group-heading-row">
                <h3 className="nav-prefs__group-heading">{tag.label}</h3>
              </div>
              <ul className="nav-prefs__list">
                {(poolByTag.get(tag.enum) ?? []).map(renderItem)}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function PoolItem({
  entry,
  atCap,
  onPin,
  onRenameCustom,
  onDeleteCustom,
  onPickIcon,
}: {
  entry: NavCatalogEntry;
  atCap: boolean;
  onPin: (key: string) => void;
  onRenameCustom?: (label: string) => void;
  onDeleteCustom?: () => void;
  onPickIcon?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${entry.key}`,
    disabled: atCap,
  });
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <li
      ref={setNodeRef}
      className={`nav-prefs__row nav-prefs__row--pool${entry.kind === "user_custom" ? " nav-prefs__row--user-custom" : ""}${isDragging ? " nav-prefs__row--dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      <span className="nav-prefs__drag-dots" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </span>
      {onRenameCustom ? (
        <InlineEditField
          value={entry.label}
          onCommit={onRenameCustom}
          ariaLabel={`Rename ${entry.label}`}
          inputClassName="nav-prefs__label-rename"
          displayClassName="nav-prefs__label"
          editing={renaming}
          onEditingChange={setRenaming}
          stopPointerOnInput
        />
      ) : (
        <span className="nav-prefs__label">{entry.label}</span>
      )}
      <div className="nav-prefs__actions">
        {entry.kind !== "user_custom" && <CoreItemBadge label={entry.label} />}
        {onPickIcon && (
          <button
            type="button"
            className="nav-prefs__icon nav-prefs__icon--pool-btn"
            aria-label={`Change icon for ${entry.label}`}
            title="Change icon"
            onClick={(e) => { e.stopPropagation(); onPickIcon(); }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <NavIcon iconKey={entry.icon} />
          </button>
        )}
        {onRenameCustom && !renaming && (
          <button
            type="button"
            className="nav-prefs__btn"
            aria-label={`Rename ${entry.label}`}
            title="Rename"
            onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            onPointerDown={(e) => e.stopPropagation()}
          >✎</button>
        )}
        {onDeleteCustom && (
          <button
            type="button"
            className="nav-prefs__btn nav-prefs__btn--danger"
            aria-label={`Delete ${entry.label}`}
            title="Delete page"
            onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="nav-prefs__btn"
          onClick={(e) => { e.stopPropagation(); onPin(entry.key); }}
          disabled={atCap}
          aria-label={`Pin ${entry.label}`}
          title={atCap ? `Pinned limit (${MAX_PINNED}) reached` : "Pin"}
          onPointerDown={(e) => e.stopPropagation()}
        >+</button>
        {confirmingDelete && onDeleteCustom && (
          <DeleteConfirm
            label={entry.label}
            onConfirm={() => { onDeleteCustom(); setConfirmingDelete(false); }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </li>
  );
}

export default function NavPreferencesPage() {
  const { user } = useAuth();
  const {
    prefs, customGroups, save, reset, catalogue, refetch, patchCatalogueEntry,
    defaultPinned, findEntry, tagByEnum, tags,
    profiles, activeProfileId, setProfileGroups,
  } = useNavPrefs();
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [newPageLabel, setNewPageLabel] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [createPageErr, setCreatePageErr] = useState<string | null>(null);
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [createGroupErr, setCreateGroupErr] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Draft persistence for the "New custom page" form. The draft only
  // Silently restore whatever the user was typing last — no banner.
  const newPageDraft = useDraft<{ label: string }>(
    { formKey: "nav.custom-page.create", initial: { label: "" } },
    (vals) => setNewPageLabel(vals.label ?? ""),
  );

  // Capture catalogue-derived helpers in refs so the draft-rebuild useEffect
  // does NOT re-run when only the catalogue mutates locally (e.g. inline
  // rename of a custom page). Without this, a label patch would rebuild
  // `itemsByBucket` from server `prefs`, clobbering any unsaved local pins.
  const findEntryRef = useRef(findEntry);
  findEntryRef.current = findEntry;
  const defaultPinnedRef = useRef(defaultPinned);
  defaultPinnedRef.current = defaultPinned;

  // Content-hash deps for the draft-rebuild useEffect. `prefs/customGroups/
  // tags` get fresh array refs on every refetch (delete/create/save), even
  // when the content is identical — that rebuild would clobber any unsaved
  // local pin/order edits. Hashing the content makes the rebuild fire only
  // when the server state truly changed.
  const prefsHash = useMemo(() => JSON.stringify(prefs), [prefs]);
  const customGroupsHash = useMemo(() => JSON.stringify(customGroups), [customGroups]);
  const tagsHash = useMemo(() => JSON.stringify(tags), [tags]);

  // Hydrate draft from server state. Both tag buckets and custom buckets
  // are produced in first-appearance order (matching sidebar logic), with
  // empty custom buckets appended by their saved position.
  useEffect(() => {
    const itemsByBucket: Record<BucketKey, DraftItem[]> = {};
    const childrenByParent: Record<string, string[]> = {};
    const orderSeen: BucketKey[] = [];
    let startPageKey: string | null = null;

    const note = (b: BucketKey) => { if (!orderSeen.includes(b)) orderSeen.push(b); };

    const pushTopLevel = (key: string, bucket: BucketKey) => {
      (itemsByBucket[bucket] ??= []).push({ key, parent: null });
      note(bucket);
    };

    if (prefs.length === 0) {
      for (const entry of defaultPinnedRef.current) {
        pushTopLevel(entry.key, tagBucket(entry.tagEnum || "personal"));
      }
    } else {
      const sorted = prefs.slice().sort((a, b) => a.position - b.position);
      // First pass: top-level rows.
      for (const p of sorted) {
        if (p.is_start_page) startPageKey = p.item_key;
        if (p.parent_item_key) continue;
        const entry = findEntryRef.current(p.item_key);
        if (!entry) continue;
        const bucket = p.group_id
          ? groupBucket(p.group_id)
          : tagBucket(entry.tagEnum || "personal");
        pushTopLevel(p.item_key, bucket);
      }
      // Second pass: children, grouped by parent in position order.
      for (const p of sorted) {
        if (!p.parent_item_key) continue;
        if (!findEntryRef.current(p.item_key)) continue;
        (childrenByParent[p.parent_item_key] ??= []).push(p.item_key);
      }
    }

    // Seed empty tag buckets so they always render as drop targets.
    // Catalogue items are locked to their tag bucket; without these, drags
    // from Available have nowhere to land when the bucket is unpinned.
    const haveTag = new Set(
      orderSeen.filter((b) => b.startsWith("tag:")).map((b) => b.slice("tag:".length)),
    );
    const emptyTags = tags
      .filter((t) => !t.isAdminMenu && !haveTag.has(t.enum))
      .slice()
      .sort((a, b) => a.defaultOrder - b.defaultOrder);
    const firstCustomIdx = orderSeen.findIndex((b) => b.startsWith("group:"));
    const insertAt = firstCustomIdx === -1 ? orderSeen.length : firstCustomIdx;
    const tagInserts: BucketKey[] = [];
    for (const t of emptyTags) {
      const b = tagBucket(t.enum);
      itemsByBucket[b] = itemsByBucket[b] ?? [];
      tagInserts.push(b);
    }
    orderSeen.splice(insertAt, 0, ...tagInserts);

    // Append empty custom buckets by position.
    const haveCustom = new Set(orderSeen.filter((b) => b.startsWith("group:")));
    const emptyCustom = customGroups
      .filter((g) => !haveCustom.has(groupBucket(g.id)))
      .slice()
      .sort((a, b) => a.position - b.position);
    for (const g of emptyCustom) {
      const b = groupBucket(g.id);
      itemsByBucket[b] = itemsByBucket[b] ?? [];
      orderSeen.push(b);
    }

    const iconOverrides: Record<string, string> = {};
    for (const p of prefs) {
      if (p.icon_override) iconOverrides[p.item_key] = p.icon_override;
    }

    setDraft({
      bucketOrder: orderSeen,
      itemsByBucket,
      childrenByParent,
      customGroups: customGroups.map((g) => ({ id: g.id, label: g.label, position: g.position })),
      startPageKey,
      iconOverrides,
    });
    setError(null);
    // Intentionally key on content hashes, not array refs. `prefs/customGroups/
    // tags` get fresh array identities on every refetch — including refetches
    // triggered by save/delete/create — even when content is identical. Hashing
    // makes the rebuild fire only when server state truly changed, so unsaved
    // local pin/order edits survive a sibling refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsHash, customGroupsHash, tagsHash]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const totalPinned = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const b of draft.bucketOrder) n += draft.itemsByBucket[b]?.length ?? 0;
    for (const cks of Object.values(draft.childrenByParent)) n += cks.length;
    return n;
  }, [draft]);

  // Total custom pages the user has authored (pinned + unpinned). Counts
  // every catalogue entry of kind "user_custom" — this is the figure that
  // counts against MAX_CUSTOM_PAGES, NOT the visible-in-Available subset.
  const customPagesTotal = useMemo(
    () => catalogue.filter((e) => e.kind === "user_custom").length,
    [catalogue],
  );

  // "Available" pool: pinnable catalogue entries not already pinned anywhere.
  const pool = useMemo<NavCatalogEntry[]>(() => {
    if (!draft) return [];
    const pinnedKeys = new Set<string>();
    for (const b of draft.bucketOrder) {
      for (const it of draft.itemsByBucket[b] ?? []) pinnedKeys.add(it.key);
    }
    for (const cks of Object.values(draft.childrenByParent)) {
      for (const ck of cks) pinnedKeys.add(ck);
    }
    return catalogue
      .filter((e) => e.pinnable && !pinnedKeys.has(e.key))
      .sort((a, b) => {
        const ta = tagByEnum(a.tagEnum)?.defaultOrder ?? 99;
        const tb = tagByEnum(b.tagEnum)?.defaultOrder ?? 99;
        if (ta !== tb) return ta - tb;
        return a.defaultOrder - b.defaultOrder;
      });
  }, [draft, catalogue, tagByEnum]);

  if (!user || !draft) return null;

  const atCap = totalPinned >= MAX_PINNED;
  const groupsAtCap = draft.customGroups.length >= MAX_CUSTOM_GROUPS;

  const pin = (key: string) => {
    if (atCap) return;
    const entry = findEntry(key);
    if (!entry) return;
    const bucket = tagBucket(entry.tagEnum || "personal");
    const next = { ...draft };
    next.itemsByBucket = { ...draft.itemsByBucket };
    next.itemsByBucket[bucket] = [...(draft.itemsByBucket[bucket] ?? []), { key, parent: null }];
    next.bucketOrder = draft.bucketOrder.includes(bucket)
      ? draft.bucketOrder
      : [...draft.bucketOrder, bucket];
    setDraft(next);
  };

  const pinFromPool = (key: string, toBucket: BucketKey, toIndex: number) => {
    if (atCap) return;
    const next: DraftState = { ...draft, itemsByBucket: { ...draft.itemsByBucket } };
    const toList = (next.itemsByBucket[toBucket] ?? []).slice();
    toList.splice(Math.min(Math.max(toIndex, 0), toList.length), 0, { key, parent: null });
    next.itemsByBucket[toBucket] = toList;
    if (!next.bucketOrder.includes(toBucket)) next.bucketOrder = [...next.bucketOrder, toBucket];
    setDraft(next);
  };

  const unpin = (key: string) => {
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
      iconOverrides: { ...draft.iconOverrides },
    };
    delete next.iconOverrides[key];
    // Remove if it's a top-level item.
    let removed = false;
    for (const b of next.bucketOrder) {
      const list = next.itemsByBucket[b] ?? [];
      const idx = list.findIndex((it) => it.key === key);
      if (idx >= 0) {
        // Promote any of its children to the same bucket position.
        const orphans = next.childrenByParent[key] ?? [];
        const newList = list.filter((it) => it.key !== key);
        // Drop orphans entirely (unpin cascades).
        next.itemsByBucket[b] = newList;
        if (orphans.length > 0) delete next.childrenByParent[key];
        removed = true;
        break;
      }
    }
    if (!removed) {
      // Remove from a parent's children list.
      for (const parentKey of Object.keys(next.childrenByParent)) {
        const cks = next.childrenByParent[parentKey];
        if (cks.includes(key)) {
          next.childrenByParent[parentKey] = cks.filter((ck) => ck !== key);
          if (next.childrenByParent[parentKey].length === 0) delete next.childrenByParent[parentKey];
          break;
        }
      }
    }
    if (next.startPageKey === key) next.startPageKey = null;
    setDraft(next);
  };

  const toggleStart = (key: string) => {
    setDraft({ ...draft, startPageKey: draft.startPageKey === key ? null : key });
  };

  const togglePicker = (key: string) => {
    setPickerKey((cur) => (cur === key ? null : key));
  };

  const setIconOverride = (key: string, icon: string) => {
    const entry = findEntry(key);
    // If chosen icon equals catalogue default, treat as a clear.
    if (entry && entry.icon === icon) {
      clearIconOverride(key);
      return;
    }
    setDraft({
      ...draft,
      iconOverrides: { ...draft.iconOverrides, [key]: icon },
    });
  };

  const clearIconOverride = (key: string) => {
    const next = { ...draft.iconOverrides };
    delete next[key];
    setDraft({ ...draft, iconOverrides: next });
  };

  const addCustomGroup = (rawLabel?: string): { ok: true } | { ok: false; reason: string } => {
    if (groupsAtCap) return { ok: false, reason: `Cap of ${MAX_CUSTOM_GROUPS} groups reached.` };
    const id = nextSyntheticId();
    const used = new Set(draft.customGroups.map((g) => g.label.toLowerCase()));
    let label: string;
    if (rawLabel != null) {
      label = rawLabel.trim().slice(0, MAX_GROUP_LABEL_LEN);
      if (!label) return { ok: false, reason: "Group name cannot be empty." };
      if (used.has(label.toLowerCase())) return { ok: false, reason: "A group with that name already exists." };
    } else {
      let n = 1;
      label = `New group ${n}`;
      while (used.has(label.toLowerCase())) {
        n += 1;
        label = `New group ${n}`;
      }
    }
    const position = draft.customGroups.length;
    const next: DraftState = {
      ...draft,
      customGroups: [...draft.customGroups, { id, label, position }],
      itemsByBucket: { ...draft.itemsByBucket, [groupBucket(id)]: [] },
      bucketOrder: [...draft.bucketOrder, groupBucket(id)],
    };
    setDraft(next);
    return { ok: true };
  };

  const renameGroup = (id: string, label: string) => {
    const trimmed = label.trim().slice(0, MAX_GROUP_LABEL_LEN);
    if (!trimmed) return;
    const dup = draft.customGroups.some(
      (g) => g.id !== id && g.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (dup) {
      setError(`Group "${trimmed}" already exists.`);
      return;
    }
    setError(null);
    setDraft({
      ...draft,
      customGroups: draft.customGroups.map((g) => (g.id === id ? { ...g, label: trimmed } : g)),
    });
  };

  const removeGroup = (id: string) => {
    // Move all items in the group back to their tag bucket.
    const bucket = groupBucket(id);
    const items = draft.itemsByBucket[bucket] ?? [];
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      bucketOrder: draft.bucketOrder.filter((b) => b !== bucket),
      customGroups: draft.customGroups
        .filter((g) => g.id !== id)
        .map((g, i) => ({ ...g, position: i })),
    };
    delete next.itemsByBucket[bucket];
    for (const it of items) {
      const entry = findEntry(it.key);
      if (!entry) continue;
      const tb = tagBucket(entry.tagEnum || "personal");
      next.itemsByBucket[tb] = [...(next.itemsByBucket[tb] ?? []), it];
      if (!next.bucketOrder.includes(tb)) next.bucketOrder = [...next.bucketOrder, tb];
    }
    setDraft(next);
  };

  // Find which bucket / parent a given item key currently lives in.
  const findOwner = (key: string): { bucket: BucketKey | null; parent: string | null } => {
    for (const b of draft.bucketOrder) {
      if ((draft.itemsByBucket[b] ?? []).some((it) => it.key === key)) {
        return { bucket: b, parent: null };
      }
    }
    for (const [parentKey, cks] of Object.entries(draft.childrenByParent)) {
      if (cks.includes(key)) return { bucket: null, parent: parentKey };
    }
    return { bucket: null, parent: null };
  };

  const moveTopLevel = (key: string, fromBucket: BucketKey, toBucket: BucketKey, toIndex: number) => {
    const next: DraftState = { ...draft, itemsByBucket: { ...draft.itemsByBucket } };
    const fromList = (next.itemsByBucket[fromBucket] ?? []).filter((it) => it.key !== key);
    next.itemsByBucket[fromBucket] = fromList;
    const toList = (next.itemsByBucket[toBucket] ?? []).slice();
    const insertAt = Math.min(Math.max(toIndex, 0), toList.length);
    toList.splice(insertAt, 0, { key, parent: null });
    next.itemsByBucket[toBucket] = toList;
    if (!next.bucketOrder.includes(toBucket)) next.bucketOrder = [...next.bucketOrder, toBucket];
    setDraft(next);
  };

  const promoteChildToTopLevel = (key: string, fromParent: string, toBucket: BucketKey, toIndex: number) => {
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
    };
    const cks = (next.childrenByParent[fromParent] ?? []).filter((ck) => ck !== key);
    if (cks.length === 0) delete next.childrenByParent[fromParent];
    else next.childrenByParent[fromParent] = cks;
    const toList = (next.itemsByBucket[toBucket] ?? []).slice();
    const insertAt = Math.min(Math.max(toIndex, 0), toList.length);
    toList.splice(insertAt, 0, { key, parent: null });
    next.itemsByBucket[toBucket] = toList;
    setDraft(next);
  };

  const nestUnderParent = (key: string, parentKey: string) => {
    if (key === parentKey) return;
    const parentEntry = findEntry(parentKey);
    const childEntry = findEntry(key);
    if (!parentEntry || !childEntry) return;
    if (childEntry.kind !== "user_custom") return;
    // Parent must be top-level, not itself a child.
    const ownerOfParent = findOwner(parentKey);
    if (!ownerOfParent.bucket) return;
    // Cap on children per parent.
    const existing = draft.childrenByParent[parentKey] ?? [];
    if (existing.includes(key)) return;
    if (existing.length >= MAX_CHILDREN_PER_PARENT) {
      setError(`Maximum ${MAX_CHILDREN_PER_PARENT} sub-pages per page.`);
      return;
    }
    setError(null);
    const next: DraftState = {
      ...draft,
      itemsByBucket: { ...draft.itemsByBucket },
      childrenByParent: { ...draft.childrenByParent },
    };
    // Detach from current location.
    const owner = findOwner(key);
    if (owner.bucket) {
      next.itemsByBucket[owner.bucket] = (next.itemsByBucket[owner.bucket] ?? []).filter((it) => it.key !== key);
      // Also drop any of this key's own children (one-level nesting).
      const grandchildren = next.childrenByParent[key];
      if (grandchildren) {
        // Promote grandchildren back to the same bucket they would normally live in.
        for (const gck of grandchildren) {
          const ge = findEntry(gck);
          if (!ge) continue;
          const tb = tagBucket(ge.tagEnum || "personal");
          next.itemsByBucket[tb] = [...(next.itemsByBucket[tb] ?? []), { key: gck, parent: null }];
          if (!next.bucketOrder.includes(tb)) next.bucketOrder = [...next.bucketOrder, tb];
        }
        delete next.childrenByParent[key];
      }
    } else if (owner.parent) {
      const cks = (next.childrenByParent[owner.parent] ?? []).filter((ck) => ck !== key);
      if (cks.length === 0) delete next.childrenByParent[owner.parent];
      else next.childrenByParent[owner.parent] = cks;
    }
    next.childrenByParent[parentKey] = [...existing, key];
    setDraft(next);
  };

  const reorderChildren = (parentKey: string, fromIdx: number, toIdx: number) => {
    const list = draft.childrenByParent[parentKey] ?? [];
    if (fromIdx < 0 || toIdx < 0) return;
    setDraft({
      ...draft,
      childrenByParent: { ...draft.childrenByParent, [parentKey]: arrayMove(list, fromIdx, toIdx) },
    });
  };

  const reorderCustomBuckets = (fromBucket: BucketKey, toBucket: BucketKey) => {
    const fromIdx = draft.bucketOrder.indexOf(fromBucket);
    const toIdx = draft.bucketOrder.indexOf(toBucket);
    if (fromIdx < 0 || toIdx < 0) return;
    const newOrder = arrayMove(draft.bucketOrder, fromIdx, toIdx);
    // Recompute custom group positions based on the resulting order.
    const customOrder = newOrder.filter((b) => b.startsWith("group:"));
    const positionByGroupId = new Map<string, number>();
    customOrder.forEach((b, i) => positionByGroupId.set(b.slice("group:".length), i));
    setDraft({
      ...draft,
      bucketOrder: newOrder,
      customGroups: draft.customGroups.map((g) => ({
        ...g,
        position: positionByGroupId.get(g.id) ?? g.position,
      })),
    });
  };

  // Move a bucket to a specific slot index (slot N = "insert before bucket
  // currently at index N"; slot bucketOrder.length = end of list). Used by
  // the explicit drop-slot targets rendered between groups during a drag.
  const moveBucketToIndex = (fromBucket: BucketKey, toIndex: number) => {
    const fromIdx = draft.bucketOrder.indexOf(fromBucket);
    if (fromIdx < 0) return;
    const cleaned = draft.bucketOrder.slice();
    cleaned.splice(fromIdx, 1);
    const insertAt = toIndex > fromIdx ? toIndex - 1 : toIndex;
    cleaned.splice(Math.min(Math.max(insertAt, 0), cleaned.length), 0, fromBucket);
    if (cleaned.join("|") === draft.bucketOrder.join("|")) return;
    const customOrder = cleaned.filter((b) => b.startsWith("group:"));
    const positionByGroupId = new Map<string, number>();
    customOrder.forEach((b, i) => positionByGroupId.set(b.slice("group:".length), i));
    setDraft({
      ...draft,
      bucketOrder: cleaned,
      customGroups: draft.customGroups.map((g) => ({
        ...g,
        position: positionByGroupId.get(g.id) ?? g.position,
      })),
    });
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };
  const onDragCancel = () => setActiveDragId(null);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // 1a) Group header dropped on an explicit between-group slot.
    if (activeId.startsWith("gheader:") && overId.startsWith("slot:")) {
      const a = activeId.slice("gheader:".length);
      const idx = parseInt(overId.slice("slot:".length), 10);
      if (Number.isFinite(idx)) moveBucketToIndex(a, idx);
      return;
    }

    // 1) Custom group header reorder (fallback when dropped on another header).
    if (activeId.startsWith("gheader:") && overId.startsWith("gheader:")) {
      const a = activeId.slice("gheader:".length);
      const o = overId.slice("gheader:".length);
      reorderCustomBuckets(a, o);
      return;
    }

    // 2) Item drag.
    if (!activeId.startsWith("item:")) return;
    const aKey = activeId.slice("item:".length);
    const aEntry = findEntry(aKey);
    if (!aEntry) return;
    const aOwner = findOwner(aKey);

    // 2a-0) Drop onto the available panel → unpin.
    if (overId === "pool:available") {
      const owner = findOwner(aKey);
      if (owner.bucket || owner.parent) unpin(aKey);
      return;
    }

    // 2a) Drop onto a parent's children droppable → nest under that parent.
    if (overId.startsWith("parent:")) {
      const parentKey = overId.slice("parent:".length);
      nestUnderParent(aKey, parentKey);
      return;
    }

    // 2b) Drop into a bucket — either via the inner-list droppable (`bucket:`)
    // or via the bucket's sortable wrapper (`gheader:`). closestCenter can
    // resolve to the header sortable when the cursor lands on the bucket's
    // header strip or the empty area between rows, so both ids must be
    // treated as a drop into that bucket's items list.
    if (overId.startsWith("bucket:") || overId.startsWith("gheader:")) {
      const targetBucket = overId.startsWith("bucket:")
        ? overId.slice("bucket:".length)
        : overId.slice("gheader:".length);
      // Catalogue items are locked to their tag bucket.
      if (aEntry.kind !== "user_custom" && targetBucket !== tagBucket(aEntry.tagEnum || "personal")) return;
      if (aOwner.bucket === targetBucket && (draft.itemsByBucket[targetBucket] ?? []).length > 0) return;
      const toIndex = (draft.itemsByBucket[targetBucket] ?? []).length;
      if (aOwner.bucket) moveTopLevel(aKey, aOwner.bucket, targetBucket, toIndex);
      else if (aOwner.parent) promoteChildToTopLevel(aKey, aOwner.parent, targetBucket, toIndex);
      else pinFromPool(aKey, targetBucket, toIndex);
      return;
    }

    // 2c) Drop onto another item.
    if (overId.startsWith("item:")) {
      const oKey = overId.slice("item:".length);
      const oOwner = findOwner(oKey);
      // Reorder within children of the same parent.
      if (aOwner.parent && aOwner.parent === oOwner.parent) {
        const list = draft.childrenByParent[aOwner.parent] ?? [];
        reorderChildren(aOwner.parent, list.indexOf(aKey), list.indexOf(oKey));
        return;
      }
      // Reorder within the same top-level bucket.
      if (aOwner.bucket && aOwner.bucket === oOwner.bucket) {
        const list = draft.itemsByBucket[aOwner.bucket] ?? [];
        const fromIdx = list.findIndex((it) => it.key === aKey);
        const toIdx = list.findIndex((it) => it.key === oKey);
        const next = { ...draft, itemsByBucket: { ...draft.itemsByBucket } };
        next.itemsByBucket[aOwner.bucket] = arrayMove(list, fromIdx, toIdx);
        setDraft(next);
        return;
      }
      // Cross-bucket move (custom item only — tag bucket items are locked).
      if (aOwner.bucket && oOwner.bucket && aOwner.bucket !== oOwner.bucket) {
        if (aEntry.kind !== "user_custom" && oOwner.bucket !== tagBucket(aEntry.tagEnum || "personal")) return;
        const toList = draft.itemsByBucket[oOwner.bucket] ?? [];
        const toIdx = toList.findIndex((it) => it.key === oKey);
        moveTopLevel(aKey, aOwner.bucket, oOwner.bucket, toIdx);
        return;
      }
      // Promote a child onto a top-level item in some bucket.
      if (aOwner.parent && oOwner.bucket) {
        if (aEntry.kind !== "user_custom" && oOwner.bucket !== tagBucket(aEntry.tagEnum || "personal")) return;
        const toList = draft.itemsByBucket[oOwner.bucket] ?? [];
        const toIdx = toList.findIndex((it) => it.key === oKey);
        promoteChildToTopLevel(aKey, aOwner.parent, oOwner.bucket, toIdx);
        return;
      }
      // Drop pool item onto a top-level item → pin next to it.
      if (!aOwner.bucket && !aOwner.parent && oOwner.bucket) {
        const toList = draft.itemsByBucket[oOwner.bucket] ?? [];
        const toIdx = toList.findIndex((it) => it.key === oKey);
        pinFromPool(aKey, oOwner.bucket, toIdx);
        return;
      }
      // Drop onto an existing child row → nest under that row's parent.
      if (oOwner.parent) {
        nestUnderParent(aKey, oOwner.parent);
        return;
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Flatten: walk bucketOrder; top-level rows carry a contiguous 0..N-1
      // position counter. Children carry a per-parent 0..M-1 counter — the
      // server validates top-level contiguity and per-parent uniqueness
      // separately, and a single shared counter would leave gaps at the top
      // level whenever any parent has children.
      const pinned: PutPrefsPinnedRow[] = [];
      let topPos = 0;
      for (const bucket of draft.bucketOrder) {
        const items = draft.itemsByBucket[bucket] ?? [];
        const isCustom = bucket.startsWith("group:");
        const groupId = isCustom ? bucket.slice("group:".length) : null;
        for (const it of items) {
          const entry = findEntry(it.key);
          if (!entry) continue;
          pinned.push({
            item_key: it.key,
            position: topPos++,
            parent_item_key: null,
            group_id: entry.kind === "user_custom" ? groupId : null,
            icon_override: draft.iconOverrides[it.key] ?? null,
          });
          let childPos = 0;
          for (const ck of draft.childrenByParent[it.key] ?? []) {
            const childEntry = findEntry(ck);
            if (!childEntry) continue;
            pinned.push({
              item_key: ck,
              position: childPos++,
              parent_item_key: it.key,
              group_id: null,
              icon_override: draft.iconOverrides[ck] ?? null,
            });
          }
        }
      }
      const groups: PutPrefsGroupRow[] = draft.customGroups.map((g, i) => ({
        id: g.id,
        label: g.label,
        position: i,
      }));
      // Non-default profiles share the pool — they must NOT carry a groups
      // payload (backend wipes-and-reinserts the pool only on Default).
      const isDefaultProfile = activeProfile?.is_default ?? true;
      const body: PutPrefsBody = isDefaultProfile
        ? { pinned, start_page_key: draft.startPageKey, groups }
        : { pinned, start_page_key: draft.startPageKey };
      const canonical = await save(body);
      // Persist this profile's group-placement junction. Server-returned
      // canonical groups arrive in payload order, so when we sent groups
      // they line up index-for-index with draft.customGroups; on
      // non-default profiles we sent nothing, so canonical is the
      // existing pool — already canonical UUIDs.
      if (activeProfileId) {
        const localToCanonical = new Map<string, string>();
        if (isDefaultProfile) {
          draft.customGroups.forEach((g, i) => {
            const c = canonical[i];
            if (c) localToCanonical.set(g.id, c.id);
          });
        }
        const groupBuckets = draft.bucketOrder.filter((b) => b.startsWith("group:"));
        const placements = groupBuckets
          .map((b, position) => {
            const localId = b.slice("group:".length);
            // Synthetic ids only get remapped on default profile (where
            // we sent the groups payload). On non-default they shouldn't
            // exist (UI prevents creation) — drop defensively.
            if (localId.startsWith("new:")) {
              const remapped = localToCanonical.get(localId);
              return remapped ? { group_id: remapped, position } : null;
            }
            return { group_id: localId, position };
          })
          .filter((p): p is { group_id: string; position: number } => p !== null)
          // Re-number positions to stay contiguous after any drops.
          .map((p, i) => ({ ...p, position: i }));
        await setProfileGroups(activeProfileId, placements);
        await refetch();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      await reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to reset");
    } finally {
      setSaving(false);
    }
  };

  const handleRenameCustomPage = (key: string, label: string) => {
    const id = key.slice("custom:".length);
    // Update local catalogue only — a full refetch would rebuild the
    // draft from server prefs and clobber any unsaved local pin edits.
    patchCustomPage(id, { label })
      .then(() => patchCatalogueEntry(key, { label }))
      .catch((e) => setError(e instanceof Error ? e.message : "Rename failed"));
  };

  const handleDeleteCustomPage = (key: string) => {
    const id = key.slice("custom:".length);
    deleteCustomPage(id)
      .then(refetch)
      .catch((e) => setError(e instanceof Error ? e.message : "Delete failed"));
  };

  const handleSetPoolIcon = (key: string, icon: string) => {
    const id = key.slice("custom:".length);
    patchCustomPage(id, { icon })
      .then(() => patchCatalogueEntry(key, { icon }))
      .catch((e) => setError(e instanceof Error ? e.message : "Icon update failed"));
  };

  // Build pool grouped by tag for display. user_custom entries break out
  // into a separate "Library" container so newly-created pages have an
  // obvious home before the user drags them into Pinned.
  const poolByTag = new Map<string, NavCatalogEntry[]>();
  const libraryEntries: NavCatalogEntry[] = [];
  for (const entry of pool) {
    if (entry.kind === "user_custom") {
      libraryEntries.push(entry);
      continue;
    }
    const list = poolByTag.get(entry.tagEnum) ?? [];
    list.push(entry);
    poolByTag.set(entry.tagEnum, list);
  }
  const poolTags = tags
    .filter((t) => poolByTag.has(t.enum))
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder);

  // Resolve heading + custom flag for each bucket.
  const bucketHeading = (b: BucketKey): { heading: string; isCustom: boolean; groupId: string | null } => {
    if (b.startsWith("tag:")) {
      const tag = tagByEnum(b.slice("tag:".length));
      return { heading: tag?.label ?? b, isCustom: false, groupId: null };
    }
    const id = b.slice("group:".length);
    const g = draft.customGroups.find((g) => g.id === id);
    return { heading: g?.label ?? "(unnamed)", isCustom: true, groupId: id };
  };

  // Sortable ids for the group-header layer — all groups are reorderable.
  const customBucketIds = draft.bucketOrder.map(groupHeaderDragId);

  return (
    <PageShell
      title="Navigation preferences"
      subtitle={
        activeProfile
          ? `Editing "${activeProfile.label}" — pin up to ${MAX_PINNED} pages, group them, and pick a start page.`
          : `Pin up to ${MAX_PINNED} pages, group them, and pick a start page.`
      }
    >
      <div className="nav-prefs__pane nav-prefs__quick-bar">
        <header className="nav-prefs__pane-header">
          <h2 className="nav-prefs__pane-title">
            Custom Navigation <span className="nav-prefs__count">{profiles.length}/{MAX_PROFILES}</span>
          </h2>
        </header>
        <ProfileBar animateEntrance />
      </div>

      <div className="nav-prefs">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <section className="nav-prefs__pane" aria-label="Pinned">
            <header className="nav-prefs__pane-header">
              <h2 className="nav-prefs__pane-title">
                Pinned <span className="nav-prefs__count">{totalPinned}/{MAX_PINNED}</span>
              </h2>
            </header>
            {draft.bucketOrder.length === 0 ? (
              <p className="nav-prefs__empty">Nothing pinned — the sidebar will show defaults until you pin something.</p>
            ) : (
              <SortableContext items={customBucketIds} strategy={verticalListSortingStrategy}>
                {activeDragId?.startsWith("gheader:") && <GroupDropSlot index={0} />}
                {draft.bucketOrder.map((b, i) => {
                  const { heading, isCustom, groupId } = bucketHeading(b);
                  const items = draft.itemsByBucket[b] ?? [];
                  // Render every bucket — including empty tag buckets — so they
                  // remain valid drop targets when dragging from Available.
                  return (
                    <Fragment key={b}>
                      <BucketBlock
                        bucketId={b}
                        heading={heading}
                        items={items}
                        childrenByParent={draft.childrenByParent}
                        startPageKey={draft.startPageKey}
                        findEntry={findEntry}
                        iconOverrides={draft.iconOverrides}
                        pickerKey={pickerKey}
                        onUnpin={unpin}
                        onToggleStart={toggleStart}
                        onPickIcon={togglePicker}
                        onSetIcon={setIconOverride}
                        onClearIcon={clearIconOverride}
                        onRename={isCustom && groupId ? (label) => renameGroup(groupId, label) : undefined}
                        onRemoveGroup={isCustom && groupId ? () => removeGroup(groupId) : undefined}
                        onRenameCustom={handleRenameCustomPage}
                        onDeleteCustom={handleDeleteCustomPage}
                        isCustom={isCustom}
                      />
                      {activeDragId?.startsWith("gheader:") && <GroupDropSlot index={i + 1} />}
                    </Fragment>
                  );
                })}
              </SortableContext>
            )}
          </section>

          <AvailablePanel
            poolTags={poolTags}
            poolByTag={poolByTag}
            libraryEntries={libraryEntries}
            atCap={atCap}
            customPagesTotal={customPagesTotal}
            onPin={pin}
            onRenameCustom={handleRenameCustomPage}
            onDeleteCustom={handleDeleteCustomPage}
            onSetPoolIcon={handleSetPoolIcon}
          />

          <section className="nav-prefs__pane nav-prefs__pane--new-page" aria-label="New custom page">
            <header className="nav-prefs__pane-header">
              <h2 className="nav-prefs__pane-title">New custom page</h2>
            </header>
            <p className="nav-prefs__new-page-card-hint">
              Holds timeline, board, or list views. New pages appear in <strong>Library</strong> above — drag one into Pinned to add it to the sidebar.
            </p>
            <form
              className="nav-prefs__new-page"
              onSubmit={async (e) => {
                e.preventDefault();
                const label = newPageLabel.trim();
                if (!label || creatingPage) return;
                setCreatingPage(true);
                setCreatePageErr(null);
                try {
                  await createCustomPage(label);
                  await newPageDraft.clear();
                  setNewPageLabel("");
                  await refetch();
                } catch (err) {
                  if (err instanceof ApiError) {
                    if (err.status === 400) {
                      setCreatePageErr("Could not create page — duplicate name or limit reached.");
                    } else if (err.status === 403) {
                      setCreatePageErr("Session expired — please refresh the page and try again.");
                    } else {
                      setCreatePageErr(`Could not create page (${err.status}: ${typeof err.body === "string" ? err.body : "server error"}).`);
                    }
                  } else {
                    setCreatePageErr("Could not create page — unexpected error.");
                  }
                } finally {
                  setCreatingPage(false);
                }
              }}
            >
              <input
                className="nav-prefs__new-page-input"
                placeholder="New page name…"
                value={newPageLabel}
                onChange={(e) => {
                  setNewPageLabel(e.target.value);
                  newPageDraft.save({ label: e.target.value });
                }}
                maxLength={64}
                disabled={creatingPage}
              />
              <button
                type="submit"
                className="btn"
                disabled={!newPageLabel.trim() || creatingPage}
              >
                {creatingPage ? "Creating…" : "+ New page"}
              </button>
            </form>
            {createPageErr && <p className="nav-prefs__error" role="alert">{createPageErr}</p>}
          </section>

          <section className="nav-prefs__pane nav-prefs__pane--new-group" aria-label="New custom group">
            <header className="nav-prefs__pane-header">
              <h2 className="nav-prefs__pane-title">
                New custom group <span className="nav-prefs__count">{draft.customGroups.length}/{MAX_CUSTOM_GROUPS}</span>
              </h2>
            </header>
            <p className="nav-prefs__new-page-card-hint">
              Custom groups appear in <strong>Pinned</strong> and can hold any custom pages you create. Drag groups by their handle to reorder.
            </p>
            <form
              className="nav-prefs__new-page"
              onSubmit={(e) => {
                e.preventDefault();
                const label = newGroupLabel.trim();
                if (!label || groupsAtCap) return;
                setCreateGroupErr(null);
                const result = addCustomGroup(label);
                if (result.ok) {
                  setNewGroupLabel("");
                } else {
                  setCreateGroupErr(result.reason);
                }
              }}
            >
              <input
                className="nav-prefs__new-page-input"
                placeholder="New group name…"
                value={newGroupLabel}
                onChange={(e) => {
                  setNewGroupLabel(e.target.value);
                  if (createGroupErr) setCreateGroupErr(null);
                }}
                maxLength={MAX_GROUP_LABEL_LEN}
                disabled={groupsAtCap}
              />
              <button
                type="submit"
                className="btn"
                disabled={!newGroupLabel.trim() || groupsAtCap}
                title={groupsAtCap ? `Cap of ${MAX_CUSTOM_GROUPS} custom groups reached` : "Add a custom group"}
              >
                + New group
              </button>
            </form>
            {createGroupErr && <p className="nav-prefs__error" role="alert">{createGroupErr}</p>}
          </section>
        </DndContext>

      </div>

      {atCap && <p className="nav-prefs__notice">Pinned limit reached — unpin an item to add another.</p>}
      {error && <p className="nav-prefs__error" role="alert">{error}</p>}

      <div className="nav-prefs__actions-bar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={handleReset}
          disabled={saving}
        >Reset to defaults</button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >{saving ? "Saving…" : "Save"}</button>
      </div>
    </PageShell>
  );
}
