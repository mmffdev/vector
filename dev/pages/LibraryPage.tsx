"use client";

import { useState, useEffect, useMemo } from "react";
import "@dev/styles/dev.css";

const PAGE_SIZE = 15;

type FileEntry = {
  name: string; dir: string; path: string; size: number; mtime: number;
};

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function LibraryPage() {
  const [files, setFiles]       = useState<FileEntry[]>([]);
  const [search, setSearch]     = useState("");
  const [page, setPage]         = useState(0);
  const [selected, setSelected] = useState<{ path: string; name: string } | null>(null);
  const [html, setHtml]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    fetch("/api/dev/library")
      .then((r) => r.json())
      .then(setFiles)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selected) { setHtml(null); return; }
    setLoading(true);
    fetch(`/api/dev/library/file?path=${encodeURIComponent(selected.path)}`)
      .then((r) => r.json())
      .then((d) => setHtml(d.html ?? ""))
      .catch(() => setHtml("<p>Failed to load document.</p>"))
      .finally(() => setLoading(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? files.filter((f) => f.name.toLowerCase().includes(q) || f.dir.toLowerCase().includes(q))
      : files;
  }, [files, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search]);

  if (selected) {
    return (
      <div className="dui-page">
        <header className="dui-page__header">
          <button
            className="dui-pager__btn"
            onClick={() => { setSelected(null); setHtml(null); }}
            aria-label="Back to Library"
          >
            ←
          </button>
          <div>
            <h1 className="dui-page__title">{selected.name}</h1>
          </div>
        </header>
        {loading
          ? (
            <div className="dui-loading">
              <span className="dui-loading__spinner" aria-hidden="true" />
              Loading…
            </div>
          )
          : <div className="dui-doc" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
        }
      </div>
    );
  }

  return (
    <div className="dui-page">
      <header className="dui-page__header">
        <div>
          <h1 className="dui-page__title">Library</h1>
          <p className="dui-page__subtitle">
            {files.length} documents — docs/ and dev/planning/
          </p>
        </div>
      </header>

      <div className="dui-toolbar">
        <input
          className="dui-search"
          type="search"
          placeholder="Search by name or directory…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="dui-toolbar__spacer" />
        <span className="dui-page__count">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <table className="dui-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Directory</th>
            <th>Size</th>
            <th>Modified</th>
          </tr>
        </thead>
        <tbody>
          {pageSlice.map((f) => (
            <tr
              key={f.path}
              onClick={() => setSelected({ path: f.path, name: f.name })}
              className="is-clickable"
            >
              <td className="dui-table__cell--name">{f.name}</td>
              <td className="dui-table__cell--muted">{f.dir}</td>
              <td className="dui-table__cell--numeric dui-table__cell--mono">{fmtSize(f.size)}</td>
              <td className="dui-table__cell--muted dui-table__cell--nowrap">{fmtDate(f.mtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="dui-pager">
          <button
            className="dui-pager__btn"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >‹</button>
          <span className="dui-pager__info">
            {page + 1} / {totalPages}
          </span>
          <button
            className="dui-pager__btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >›</button>
        </div>
      )}
    </div>
  );
}
