"use client";

// HomepageSection — the "where do you want Vector to land you when you
// sign in?" dropdown on /user/account-settings. Writes
// users_nav_profiles.start_page_key via PUT /_site/nav/prefs (existing
// handler). The login flow's GET /_site/nav/start-page resolver at
// app/login/page.tsx:134 already consumes the value.
//
// Page list comes from useNavPrefs().catalogue, which the backend
// server-side filters by users_roles_pages — buckets with zero permitted
// pages are absent from the payload, so they never render here. No
// client-side permission check (the catalogue IS the clamp).
//
// Distinct from <HomeLocationSection /> which writes
// users.default_focus_node_id (topology node, not URL). They sit next to
// each other but answer different questions.
//
// Sentinel-free: this component never imports from @/app/sentinel/*.

import { useMemo, useState } from "react";
import { useNavPrefs, type NavCatalogEntry } from "@/app/contexts/NavPrefsContext";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

interface Bucket {
  enum: string;
  label: string;
  defaultOrder: number;
  pages: NavCatalogEntry[];
}

export default function HomepageSection() {
  const { catalogue, tags, prefs, setStartPageKey, loading } = useNavPrefs();
  const [busy, setBusy] = useState(false);

  const currentKey = useMemo(
    () => prefs.find((p) => p.is_start_page)?.item_key ?? "",
    [prefs],
  );

  const buckets = useMemo<Bucket[]>(() => {
    const byEnum = new Map<string, Bucket>();
    for (const t of tags) {
      if (t.isAdminMenu) continue;
      byEnum.set(t.enum, {
        enum: t.enum,
        label: t.label,
        defaultOrder: t.defaultOrder,
        pages: [],
      });
    }
    for (const entry of catalogue) {
      if (!entry.pinnable) continue;
      const bucket = byEnum.get(entry.tagEnum);
      if (bucket) bucket.pages.push(entry);
    }
    return Array.from(byEnum.values())
      .filter((b) => b.pages.length > 0)
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((b) => ({
        ...b,
        pages: [...b.pages].sort((p, q) => p.defaultOrder - q.defaultOrder),
      }));
  }, [catalogue, tags]);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    setBusy(true);
    try {
      await setStartPageKey(next);
      notify.success("Home page saved");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
        notify.error("You no longer have access to that page.");
      } else {
        notify.error("Could not save home page. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && catalogue.length === 0) {
    return (
      <>
        <h3 className="eyebrow">Home Page</h3>
        <p className="form__hint">Loading…</p>
      </>
    );
  }

  if (buckets.length === 0) {
    return (
      <>
        <h3 className="eyebrow">Home Page</h3>
        <p className="form__hint">You don&apos;t have access to any pages yet.</p>
      </>
    );
  }

  return (
    <>
      <h3 className="eyebrow">Home Page</h3>
      <form className="form u-mb-8" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Where do you want Vector to land you when you sign in?
            <select
              className="form__input"
              value={currentKey}
              onChange={onChange}
              disabled={busy}
            >
              <option value="">— (none — use default) —</option>
              {buckets.map((b) => (
                <optgroup key={b.enum} label={b.label}>
                  {b.pages.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="form__hint">
              Sets the first page you see after signing in.
            </span>
          </label>
        </div>
      </form>
    </>
  );
}
