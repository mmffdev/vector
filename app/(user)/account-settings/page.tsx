"use client";

/**
 * /account-settings — Story 00103 future-state restyle.
 *
 * Personal account surface for the signed-in user. Three sections
 * separated by .eyebrow micro-headings:
 *   1. Profile         — display name, email (read-only).
 *   2. Password        — current/new/confirm with .form__hint guidance.
 *   3. Notifications   — switch row per channel (.form__switch + .pill).
 *
 * Vector kit only: PageShell header, .form / .form__row / .form__label /
 * .form__input, single .btn--primary "Save changes" per region. No
 * card surfaces (this page sits on --canvas), no box-shadow, no
 * brand colour. Disabled inputs use --surface-sunken via the
 * standard form rules in globals.css.
 */

import { useState } from "react";
import PageContent from "@/app/components/PageContent";
import { useAuth } from "@/app/contexts/AuthContext";

export default function AccountSettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [emailNotif, setEmailNotif] = useState(true);
  const [productNotif, setProductNotif] = useState(false);
  const [digestNotif, setDigestNotif] = useState(true);

  if (!user) return null;

  return (
    <PageContent>
      <h3 className="eyebrow">Profile</h3>
      <form
        className="form u-mb-8"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="form__row">
          <label className="form__label">
            Display name
            <input
              type="text"
              className="form__input"
              value={displayName}
              placeholder={user.email.split("@")[0]}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Email
            <input
              type="email"
              className="form__input"
              value={user.email}
              disabled
            />
            <span className="form__hint">
              Contact your workspace administrator to change your sign-in email.
            </span>
          </label>
        </div>
        <div className="u-row u-row--end">
          <button type="submit" className="btn btn--primary">
            Save profile
          </button>
        </div>
      </form>

      <h3 className="eyebrow">Password</h3>
      <form
        className="form u-mb-8"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="form__row">
          <label className="form__label">
            Current password
            <input type="password" className="form__input" autoComplete="current-password" />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            New password
            <input type="password" className="form__input" autoComplete="new-password" />
            <span className="form__hint">
              At least 12 characters, with one number and one symbol.
            </span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Confirm new password
            <input type="password" className="form__input" autoComplete="new-password" />
          </label>
        </div>
        <div className="u-row u-row--end">
          <button type="submit" className="btn btn--primary">
            Update password
          </button>
        </div>
      </form>

      <h3 className="eyebrow">Notifications</h3>
      <div className="form u-row--gap-3">
        <NotifRow
          label="Direct mentions"
          hint="Email me when someone @mentions me in a comment."
          checked={emailNotif}
          onChange={setEmailNotif}
        />
        <NotifRow
          label="Product releases"
          hint="Email me when a new library release ships."
          checked={productNotif}
          onChange={setProductNotif}
        />
        <NotifRow
          label="Weekly digest"
          hint="A Monday morning summary of activity in your portfolios."
          checked={digestNotif}
          onChange={setDigestNotif}
        />
      </div>
    </PageContent>
  );
}

function NotifRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="notif-row">
      <div>
        <div className="notif-row__label">{label}</div>
        <div className="notif-row__hint">{hint}</div>
      </div>
      <label className="form__switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={`pill ${checked ? "pill--success" : "pill--neutral"}`}>
          {checked ? "On" : "Off"}
        </span>
      </label>
    </div>
  );
}
