import Link from "next/link";

// AuthFooter — shared footer for all pre-auth pages
// (/login/reset, /login/reset/confirm, /change-password when unauthed).
//
// Carries the same system-use notification as the main /login page so
// the legal posture is consistent across every entry point a hostile
// actor could land on. Satisfies: NIST 800-53 AC-8 (System Use
// Notification), SOC 2 CC6.1, CMMC AC.L2-3.1.9, ISO 27001 A.5.10,
// UK Computer Misuse Act 1990 §§ 1–3. The explicit statutory
// reference materially strengthens prosecution under CMA § 1 by
// closing the "I didn't know access was unauthorised" defence.
export function AuthFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="auth-page__footer">
      <div className="auth-warning" role="note" aria-label="System use notification">
        <div className="auth-warning__head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3 2 21h20L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 10v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="18" r="0.8" fill="currentColor" />
          </svg>
          <span>RESTRICTED SYSTEM — AUTHORISED ACCESS ONLY</span>
        </div>
        <p>
          This is a private system operated by MMFFDev. Access is restricted to authorised users
          acting within the scope of their granted permissions. Unauthorised access, use,
          modification, or disclosure of information held on this system is prohibited and
          will be investigated and prosecuted to the fullest extent of the law.
        </p>
        <p>
          In the United Kingdom this includes prosecution under the <strong>Computer Misuse Act 1990
          (sections 1–3)</strong> and the Data Protection Act 2018. Elsewhere, equivalent national and
          international laws apply, including (without limitation) the United States Computer Fraud
          and Abuse Act, the EU NIS2 Directive, and applicable provisions of the jurisdiction in
          which the user is located.
        </p>
        <p>
          All activity on this system — including authentication attempts, session events, data
          access, and administrative actions — is logged, retained, and may be monitored,
          inspected, and disclosed to law-enforcement or regulatory authorities where lawfully
          required. There is no expectation of privacy on this system.
        </p>
        <p className="auth-warning__consent">
          By continuing you acknowledge this notice, confirm you are an authorised user, and consent
          to monitoring. You also accept the <Link href="/terms">terms of use</Link> and
          {" "}<Link href="/cookies">cookie policy</Link>.
        </p>
      </div>
      <div className="auth-page__copyright">© {year} MMFFDev. All rights reserved.</div>
    </footer>
  );
}
