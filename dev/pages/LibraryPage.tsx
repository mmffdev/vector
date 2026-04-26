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
      <div className="dev-root">
        <header className="dev-page-header">
          <button className="dev-btn" onClick={() => { setSelected(null); setHtml(null); }}>
            ← Library
          </button>
          <h1 className="dev-page-header__title dev-library__doc-title">{selected.name}</h1>
        </header>
        {loading
          ? <p className="dev-p">Loading…</p>
          : <div className="dev-library__md-body" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
        }
      </div>
    );
  }

  return (
    <div className="dev-root">
      <header className="dev-page-header">
        <h1 className="dev-page-header__title">Library</h1>
        <p className="dev-page-header__subtitle">
          {files.length} documents — docs/ and dev/planning/
        </p>
      </header>

      <div className="dev-library">
        <div className="dev-library__toolbar">
          <input
            className="dev-library__search"
            type="search"
            placeholder="Search by name or directory…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="dev-library__count">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        <table className="dev-library__table">
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
              <tr key={f.path} onClick={() => setSelected({ path: f.path, name: f.name })}
                  className="dev-library__row">
                <td className="dev-library__name">{f.name}</td>
                <td className="dev-library__dir">{f.dir}</td>
                <td className="dev-library__size">{fmtSize(f.size)}</td>
                <td className="dev-library__mtime">{fmtDate(f.mtime)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="dev-library__pagination">
            <button className="dev-btn" disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="dev-library__page-info">
              Page {page + 1} of {totalPages}
            </span>
            <button className="dev-btn" disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
