"use client";

/**
 * BlockingReleaseGate — renders a blocking modal when the subscription
 * has unacknowledged breaking library releases (Phase 3, plan §12.6).
 *
 * Wrap any gadmin page with this component. When has_blocking is true
 * the page content is replaced by a full-screen overlay directing the
 * gadmin to /library-releases to acknowledge before continuing.
 * Non-gadmins (and null count states) pass straight through.
 */

import Link from "next/link";
import { useLibraryReleases } from "@/app/contexts/LibraryReleasesContext";
import { useAuth } from "@/app/contexts/AuthContext";

export default function BlockingReleaseGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { hasBlocking } = useLibraryReleases();

  if (user?.role !== "gadmin" || !hasBlocking) {
    return <>{children}</>;
  }

  return (
    <div className="blocking-gate">
      <div className="blocking-gate__dialog">
        <div className="blocking-gate__icon" aria-hidden="true">⚠</div>
        <h2 className="blocking-gate__title">Action required</h2>
        <p className="blocking-gate__body">
          There are breaking library releases that require your acknowledgement
          before you can continue. Please review and acknowledge them to proceed.
        </p>
        <Link href="/library-releases" className="btn btn--primary blocking-gate__cta">
          Review releases
        </Link>
      </div>
    </div>
  );
}
