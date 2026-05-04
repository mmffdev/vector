"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";
import HelpDocRenderer, {
  type HelpDoc,
  type VideoEmbed,
  type ImageRef,
} from "@/app/components/HelpDocRenderer";

type AdminRow = {
  help_id: string;
  addressable_id: string;
  address: string;
  page_route: string;
  kind: string;
  name: string;
  locale: string;
  title: string | null;
  body_html: string;
  video_embeds: VideoEmbed[];
  image_urls: ImageRef[];
  seeded_from: string | null;
  is_library_default: boolean;
  updated_at: string;
  updated_by_email: string | null;
  helpable: boolean;
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

// Coerce any wire shape (including the legacy body_html-only one) into a
// fully-populated AdminRow whose video_embeds / image_urls are arrays.
function normalizeRow(raw: Partial<AdminRow> & Record<string, unknown>): AdminRow {
  const videos = Array.isArray(raw.video_embeds)
    ? (raw.video_embeds as VideoEmbed[])
    : [];
  const images = Array.isArray(raw.image_urls)
    ? (raw.image_urls as ImageRef[])
    : [];
  return {
    help_id: String(raw.help_id ?? ""),
    addressable_id: String(raw.addressable_id ?? ""),
    address: String(raw.address ?? ""),
    page_route: String(raw.page_route ?? ""),
    kind: String(raw.kind ?? ""),
    name: String(raw.name ?? ""),
    locale: String(raw.locale ?? "en"),
    title: (raw.title as string | null | undefined) ?? null,
    body_html: String(raw.body_html ?? ""),
    video_embeds: videos,
    image_urls: images,
    seeded_from: (raw.seeded_from as string | null | undefined) ?? null,
    is_library_default: Boolean(raw.is_library_default),
    updated_at: String(raw.updated_at ?? ""),
    updated_by_email: (raw.updated_by_email as string | null | undefined) ?? null,
    helpable: Boolean(raw.helpable),
  };
}

function HelpRow({
  row,
  onChanged,
  onArchived,
}: {
  row: AdminRow;
  onChanged: (next: AdminRow) => void;
  onArchived: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState<string>(row.title ?? "");
  const [draftBody, setDraftBody] = useState(row.body_html);
  const [draftVideos, setDraftVideos] = useState<VideoEmbed[]>(row.video_embeds);
  const [draftImages, setDraftImages] = useState<ImageRef[]>(row.image_urls);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [togglingHelpable, setTogglingHelpable] = useState(false);

  async function toggleHelpable(next: boolean) {
    setTogglingHelpable(true);
    setError(null);
    try {
      await api(`/api/addressables/admin/${encodeURIComponent(row.addressable_id)}/helpable`, {
        method: "PATCH",
        body: JSON.stringify({ helpable: next }),
      });
      onChanged({ ...row, helpable: next });
    } catch (e: any) {
      setError(e?.message ?? "Toggle failed.");
    } finally {
      setTogglingHelpable(false);
    }
  }

  function startEdit() {
    setDraftTitle(row.title ?? "");
    setDraftBody(row.body_html);
    setDraftVideos(row.video_embeds);
    setDraftImages(row.image_urls);
    setError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);

    // Normalise + assign positions before submitting; drop blank rows.
    const cleanVideos = draftVideos
      .map((v) => ({ ...v, url: (v.url ?? "").trim(), title: (v.title ?? "").trim() || undefined }))
      .filter((v) => v.url.length > 0)
      .map((v, idx) => ({ ...v, position: idx }));
    const cleanImages = draftImages
      .map((i) => ({
        ...i,
        url: (i.url ?? "").trim(),
        alt: (i.alt ?? "").trim() || undefined,
        caption: (i.caption ?? "").trim() || undefined,
      }))
      .filter((i) => i.url.length > 0)
      .map((i, idx) => ({ ...i, position: idx }));

    const titleTrimmed = draftTitle.trim();
    const titleField: string | null = titleTrimmed.length > 0 ? titleTrimmed : null;

    try {
      await api(`/api/page-help/admin/${encodeURIComponent(row.addressable_id)}`, {
        method: "PUT",
        body: JSON.stringify({
          locale: row.locale,
          title: titleField,
          body: draftBody,
          video_embeds: cleanVideos,
          image_urls: cleanImages,
        }),
      });
      onChanged({
        ...row,
        title: titleField,
        body_html: draftBody,
        video_embeds: cleanVideos,
        image_urls: cleanImages,
        is_library_default: false,
        seeded_from: "manual",
        updated_at: new Date().toISOString(),
      });
      setEditing(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    setSaving(true);
    setError(null);
    try {
      const url = `/api/page-help/admin/${encodeURIComponent(row.addressable_id)}?locale=${encodeURIComponent(row.locale)}`;
      await api(url, { method: "DELETE" });
      onArchived(row.help_id);
    } catch (e: any) {
      setError(e?.message ?? "Archive failed.");
      setSaving(false);
    }
  }

  // Live preview doc — built from the current draft state, fed to the
  // same renderer the popover and /help/<id> page use so what gadmin
  // sees is exactly what the user will see.
  const previewDoc: HelpDoc = {
    addressable_id: row.addressable_id,
    title: draftTitle.trim() || null,
    body_html: draftBody,
    video_embeds: draftVideos,
    image_urls: draftImages,
  };

  const header = (
    <>
      <span className="dev-plan-id">{row.address}</span>
      <span className="dev-plan-meta">
        <span className="dev-plan-dates-strip">
          <span>{row.kind}</span>
          <span>edited {fmtDate(row.updated_at)}</span>
          <span>by {row.updated_by_email ?? "—"}</span>
        </span>
      </span>
      {row.is_library_default && <span className="badge">library default</span>}
      {row.video_embeds.length > 0 && (
        <span className="badge">{row.video_embeds.length} video{row.video_embeds.length === 1 ? "" : "s"}</span>
      )}
      {row.image_urls.length > 0 && (
        <span className="badge">{row.image_urls.length} image{row.image_urls.length === 1 ? "" : "s"}</span>
      )}
      {savedToast && <span className="badge badge-pass">saved</span>}
    </>
  );

  return (
    <DevAccordionItem header={header}>
      {!editing && (
        <div className="dev-plan-body">
          <HelpDocRenderer
            doc={{
              addressable_id: row.addressable_id,
              title: row.title,
              body_html: row.body_html,
              video_embeds: row.video_embeds,
              image_urls: row.image_urls,
            }}
            variant="full"
            showOpenFullLink={false}
          />
          {error && <div className="dev-alert dev-alert--error" style={{ marginTop: 8 }}>{error}</div>}
          <label className="dev-p" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={row.helpable}
              disabled={togglingHelpable}
              onChange={e => toggleHelpable(e.target.checked)}
            />
            Help icon visible
            {togglingHelpable && <span className="dev-plan-meta">· saving…</span>}
          </label>
          <div className="dev-btn-group" style={{ marginTop: 12 }}>
            <button className="dev-btn dev-btn--primary dev-btn--sm" onClick={startEdit}>Edit</button>
            <a
              className="dev-btn dev-btn--sm"
              href={`/help/${encodeURIComponent(row.addressable_id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open page
            </a>
            {!confirmArchive && (
              <button className="dev-btn dev-btn--danger dev-btn--sm" onClick={() => setConfirmArchive(true)} disabled={saving}>
                Archive
              </button>
            )}
            {confirmArchive && (
              <>
                <button className="dev-btn dev-btn--danger dev-btn--sm" onClick={archive} disabled={saving}>
                  {saving ? "Archiving…" : "Confirm archive"}
                </button>
                <button className="dev-btn dev-btn--sm" onClick={() => setConfirmArchive(false)} disabled={saving}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="dev-plan-body">
          <div className="dev-help-editor">
            <label className="dev-p" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
              Title
            </label>
            <input
              type="text"
              className="dev-research-search"
              style={{ width: "100%" }}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={saving}
              placeholder="Optional heading shown above the body"
            />

            <label className="dev-p" style={{ display: "block", fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
              Body HTML
            </label>
            <textarea
              className="dev-research-search"
              style={{ width: "100%", minHeight: 160, fontFamily: "var(--font-mono, monospace)" }}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              disabled={saving}
              placeholder="<p>Help body HTML…</p>"
            />

            <fieldset className="dev-help-editor__group" style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
              <legend className="dev-p" style={{ fontWeight: 600 }}>YouTube videos</legend>
              {draftVideos.length === 0 && (
                <p className="dev-plan-meta" style={{ marginTop: 0 }}>No videos. Use Add to attach one.</p>
              )}
              {draftVideos.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <input
                      type="url"
                      className="dev-research-search"
                      placeholder="https://www.youtube.com/watch?v=…"
                      value={v.url}
                      disabled={saving}
                      onChange={(e) =>
                        setDraftVideos((arr) =>
                          arr.map((row, i) => (i === idx ? { ...row, url: e.target.value } : row)),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="dev-research-search"
                      placeholder="Optional caption"
                      value={v.title ?? ""}
                      disabled={saving}
                      onChange={(e) =>
                        setDraftVideos((arr) =>
                          arr.map((row, i) => (i === idx ? { ...row, title: e.target.value } : row)),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="dev-btn dev-btn--sm dev-btn--danger"
                    onClick={() => setDraftVideos((arr) => arr.filter((_, i) => i !== idx))}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="dev-btn dev-btn--sm"
                onClick={() => setDraftVideos((arr) => [...arr, { url: "", title: "" }])}
                disabled={saving}
              >
                Add video
              </button>
            </fieldset>

            <fieldset className="dev-help-editor__group" style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
              <legend className="dev-p" style={{ fontWeight: 600 }}>Images</legend>
              {draftImages.length === 0 && (
                <p className="dev-plan-meta" style={{ marginTop: 0 }}>No images. Use Add to attach one.</p>
              )}
              {draftImages.map((img, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <input
                      type="url"
                      className="dev-research-search"
                      placeholder="https://… (image URL)"
                      value={img.url}
                      disabled={saving}
                      onChange={(e) =>
                        setDraftImages((arr) =>
                          arr.map((row, i) => (i === idx ? { ...row, url: e.target.value } : row)),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="dev-research-search"
                      placeholder="Alt text (accessibility)"
                      value={img.alt ?? ""}
                      disabled={saving}
                      onChange={(e) =>
                        setDraftImages((arr) =>
                          arr.map((row, i) => (i === idx ? { ...row, alt: e.target.value } : row)),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="dev-research-search"
                      placeholder="Caption shown under the image"
                      value={img.caption ?? ""}
                      disabled={saving}
                      onChange={(e) =>
                        setDraftImages((arr) =>
                          arr.map((row, i) => (i === idx ? { ...row, caption: e.target.value } : row)),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="dev-btn dev-btn--sm dev-btn--danger"
                    onClick={() => setDraftImages((arr) => arr.filter((_, i) => i !== idx))}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="dev-btn dev-btn--sm"
                onClick={() => setDraftImages((arr) => [...arr, { url: "", alt: "", caption: "" }])}
                disabled={saving}
              >
                Add image
              </button>
            </fieldset>

            <div style={{ marginTop: 12 }}>
              <p className="dev-p" style={{ marginBottom: 4, fontWeight: 600 }}>Live preview (full page)</p>
              <div style={{ padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
                <HelpDocRenderer doc={previewDoc} variant="full" showOpenFullLink={false} />
              </div>
            </div>
          </div>

          {error && <div className="dev-alert dev-alert--error" style={{ marginTop: 8 }}>{error}</div>}
          <div className="dev-btn-group" style={{ marginTop: 12 }}>
            <button className="dev-btn dev-btn--primary dev-btn--sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="dev-btn dev-btn--sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </DevAccordionItem>
  );
}

export default function DevPageHelpPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Array<Partial<AdminRow> & Record<string, unknown>>>("/api/page-help/admin/");
      setRows((data ?? []).map(normalizeRow));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load page_help rows.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? rows.filter(r => r.address.toLowerCase().includes(q) || r.page_route.toLowerCase().includes(q))
      : rows;
    const out = new Map<string, AdminRow[]>();
    for (const r of filtered) {
      const list = out.get(r.page_route) ?? [];
      list.push(r);
      out.set(r.page_route, list);
    }
    return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, search]);

  if (!user) return null;
  if (user.role.code !== "gadmin") {
    return (
      <div className="dev-research-empty">
        Page Help editor is gadmin-only. Your role: <code>{user.role.code}</code>.
      </div>
    );
  }

  return (
    <Panel name="dev_page_help" title="Page Help">
    <div className="dev-plans-panel">
      <div className="dev-research-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Edit the help body shown by the <code>TbHelpHexagon</code> popover on every registered addressable.
            Saved edits flip <code>seeded_from='manual'</code> (the schema's name for editor-authored content);
            future library churn will not retro-apply.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="dev-btn dev-btn--sm">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="dev-research-toolbar">
        <input
          type="search"
          className="dev-research-search"
          placeholder="Search by address or page_route…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="dev-research-empty">
          No page_help rows. Register addressables via build-reconcile first.
        </div>
      )}

      {grouped.map(([route, list]) => (
        <section key={route} className="dev-section">
          <h3 className="dev-h3"><code>{route}</code> <span className="dev-plan-meta">· {list.length} row{list.length === 1 ? "" : "s"}</span></h3>
          <DevAccordion>
            {list.map(r => (
              <HelpRow
                key={r.help_id}
                row={r}
                onChanged={next => setRows(prev => prev.map(x => x.help_id === next.help_id ? next : x))}
                onArchived={id => setRows(prev => prev.filter(x => x.help_id !== id))}
              />
            ))}
          </DevAccordion>
        </section>
      ))}

      {!loading && grouped.length === 0 && rows.length > 0 && (
        <div className="dev-research-empty">
          No rows match &ldquo;<em>{search}</em>&rdquo;.
        </div>
      )}
    </div>
    </Panel>
  );
}
