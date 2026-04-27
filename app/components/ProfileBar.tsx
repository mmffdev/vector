"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavPrefs, type NavProfile } from "@/app/contexts/NavPrefsContext";

const MAX_PROFILES = 10;
const MAX_LABEL = 32;

type EditState =
  | { mode: "idle" }
  | { mode: "creating" }
  | { mode: "renaming"; id: string };

export default function ProfileBar() {
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    loading,
  } = useNavPrefs();

  const [edit, setEdit] = useState<EditState>({ mode: "idle" });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (edit.mode !== "idle") inputRef.current?.focus();
  }, [edit.mode]);

  const reset = useCallback(() => {
    setEdit({ mode: "idle" });
    setDraft("");
    setError(null);
  }, []);

  const startCreate = useCallback(() => {
    setEdit({ mode: "creating" });
    setDraft("");
    setError(null);
  }, []);

  const startRename = useCallback((p: NavProfile) => {
    setEdit({ mode: "renaming", id: p.id });
    setDraft(p.label);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    if (trimmed.length > MAX_LABEL) {
      setError(`Max ${MAX_LABEL} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (edit.mode === "creating") {
        await createProfile(trimmed);
      } else if (edit.mode === "renaming") {
        await renameProfile(edit.id, trimmed);
      }
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [draft, edit, createProfile, renameProfile, reset]);

  const remove = useCallback(async (p: NavProfile) => {
    if (p.is_default) return;
    if (!confirm(`Delete profile "${p.label}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProfile(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [deleteProfile]);

  if (loading || profiles.length === 0) return null;

  const ordered = profiles.slice().sort((a, b) => a.position - b.position);
  const atCap = profiles.length >= MAX_PROFILES;

  return (
    <div className="profile-bar" role="tablist" aria-label="Navigation profiles">
      {ordered.map((p) => {
        const active = p.id === activeProfileId;
        const renamingThis = edit.mode === "renaming" && edit.id === p.id;

        if (renamingThis) {
          return (
            <span key={p.id} className="profile-bar__edit">
              <input
                ref={inputRef}
                type="text"
                className="profile-bar__input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") reset();
                }}
                onBlur={() => { if (!busy) reset(); }}
                disabled={busy}
                maxLength={MAX_LABEL}
                aria-label="Rename profile"
              />
            </span>
          );
        }

        return (
          <span key={p.id} className="profile-bar__cell">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`profile-bar__pill ${active ? "active" : ""}`}
              onClick={() => { if (!active) void setActiveProfile(p.id); }}
              title={p.label}
            >
              {p.label}
            </button>
            <span className="profile-bar__cell-actions">
              <button
                type="button"
                className="profile-bar__icon-btn"
                onClick={(e) => { e.stopPropagation(); startRename(p); }}
                title="Rename profile"
                aria-label={`Rename ${p.label}`}
                disabled={busy}
              >
                ✎
              </button>
              {!p.is_default && (
                <button
                  type="button"
                  className="profile-bar__icon-btn profile-bar__icon-btn--danger"
                  onClick={(e) => { e.stopPropagation(); void remove(p); }}
                  title="Delete profile"
                  aria-label={`Delete ${p.label}`}
                  disabled={busy}
                >
                  ×
                </button>
              )}
            </span>
          </span>
        );
      })}

      {edit.mode === "creating" ? (
        <span className="profile-bar__edit">
          <input
            ref={inputRef}
            type="text"
            className="profile-bar__input"
            value={draft}
            placeholder="Profile name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") reset();
            }}
            onBlur={() => { if (!busy) reset(); }}
            disabled={busy}
            maxLength={MAX_LABEL}
            aria-label="New profile name"
          />
        </span>
      ) : (
        <button
          type="button"
          className="profile-bar__add"
          onClick={startCreate}
          disabled={atCap || busy}
          title={atCap ? `Profile limit reached (${MAX_PROFILES})` : "New profile"}
          aria-label="New profile"
        >
          +
        </button>
      )}

      {error && (
        <span className="profile-bar__error" role="alert">{error}</span>
      )}
    </div>
  );
}
