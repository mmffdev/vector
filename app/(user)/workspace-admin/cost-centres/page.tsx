"use client";

// B20.4.3 — cost centres admin page. Gadmin-only (gated by the
// cost_centres.manage permission both client- and server-side per the
// SERVER IS THE GATE hard rule). CRUDs cost-centre rows; the per-user
// edit panel reads from the same /cost-centres endpoint to populate
// the cost-centre dropdown.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { useHasPermission } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { costCentresApi, type CostCentre } from "@/app/lib/costCentresApi";
import { ApiError } from "@/app/lib/api";

export default function CostCentresPage() {
  const { full } = usePageTitle();
  const canManage = useHasPermission("cost_centres.manage");

  const [rows,      setRows]      = useState<CostCentre[] | null>(null);
  const [err,       setErr]       = useState<string | null>(null);
  const [info,      setInfo]      = useState<string | null>(null);
  const [busy,      setBusy]      = useState(false);

  // Create form state
  const [newCode,   setNewCode]   = useState("");
  const [newName,   setNewName]   = useState("");
  const [newParent, setNewParent] = useState<string>("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await costCentresApi.list();
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load cost centres.");
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const parentOptions = useMemo(() => {
    return [
      { id: "", label: "(top level)" },
      ...(rows ?? []).map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` })),
    ];
  }, [rows]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      await costCentresApi.create({
        code: newCode.trim(),
        name: newName.trim(),
        parent_id: newParent || null,
      });
      setNewCode("");
      setNewName("");
      setNewParent("");
      setInfo("Cost centre created.");
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr("That code is already in use.");
      else setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: string) {
    if (!confirm("Archive this cost centre? Existing user assignments stay intact; the centre disappears from new pickers.")) {
      return;
    }
    setErr(null);
    setInfo(null);
    try {
      await costCentresApi.archive(id);
      setInfo("Cost centre archived.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Archive failed.");
    }
  }

  if (!canManage) {
    return (
      <PageContent>
        <PageHeading level={1} title={full} subtitle="Cost centres" />
        <PageDescription title="Cost Centres">
          <p className="form__hint">
            Forbidden — you do not have the <code>cost_centres.manage</code> permission required to administer cost centres.
          </p>
        </PageDescription>
      </PageContent>
    );
  }

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage cost centres for finance reporting." />
      <PageDescription title="Cost Centres">
        <p className="form__hint">
          Cost centres are the structured finance buckets that user assignments
          and roll-up reports group by. Each centre has an operator-facing
          code (e.g. <code>FIN-001</code>) and a human-readable name. Centres
          form a hierarchy via the optional Parent picker. Archived centres
          stay queryable for historical user assignments but disappear from
          the new-grant picker.
        </p>
      </PageDescription>

      <Panel name="cost_centres_create" title="Create cost centre">
        <form className="form" onSubmit={onCreate}>
          <div className="form__grid">
            <label className="form__label">
              Code
              <input
                type="text"
                className="form__input"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="FIN-001"
                required
              />
            </label>
            <label className="form__label">
              Name
              <input
                type="text"
                className="form__input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Finance — corporate"
                required
              />
            </label>
            <label className="form__label">
              Parent
              <select
                className="form__select"
                value={newParent}
                onChange={(e) => setNewParent(e.target.value)}
              >
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy || !newCode.trim() || !newName.trim()}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Panel>

      {err  && <div className="form__error">{err}</div>}
      {info && <div className="form__info">{info}</div>}

      <Panel name="cost_centres_list" title="Existing cost centres">
        {rows == null ? (
          <p className="form__hint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="form__hint">No cost centres yet — create the first one above.</p>
        ) : (
          <Table<CostCentre>
            pageId="cost-centres"
            slot="list"
            ariaLabel="Cost centres"
            rowKey={(r) => r.id}
            rows={rows}
            columns={[
              { key: "code", header: "Code", width: 180, kind: "custom", render: (r) => r.code },
              { key: "name", header: "Name", kind: "custom", render: (r) => r.name },
              {
                key: "parent",
                header: "Parent",
                width: 220,
                kind: "custom",
                render: (r) => {
                  if (!r.parent_id) return <span className="form__hint">(top level)</span>;
                  const parent = rows.find((p) => p.id === r.parent_id);
                  return parent ? `${parent.code}` : <span className="form__hint">(orphan)</span>;
                },
              },
              {
                key: "actions",
                header: "",
                width: 140,
                kind: "custom",
                render: (r) => (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => onArchive(r.id)}
                  >
                    Archive
                  </button>
                ),
              },
            ]}
          />
        )}
      </Panel>
    </PageContent>
  );
}
