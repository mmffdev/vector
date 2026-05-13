const Icon = ({ d, d2, d3 }: { d: string; d2?: string; d3?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {d2 && <path d={d2} />}
    {d3 && <path d={d3} />}
  </svg>
);

export function NavIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {

    /* ── Navigation & Home ── */
    case "home":            return <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "compass":         return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />;
    case "map":             return <Icon d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" d2="M8 2v16M16 6v16" />;
    case "pin":             return <Icon d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" d2="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "pin-push":        return <Icon d="M12 17v5M9 10.76A2 2 0 0 1 8 9V4h8v5a2 2 0 0 1-1 1.76l-1 .58a2 2 0 0 0-1 1.76V17H10v-3.9a2 2 0 0 0-1-1.76z" />;
    case "navigation":      return <Icon d="M3 11l19-9-9 19-2-8-8-2z" />;
    case "arrow-up-right":  return <Icon d="M7 17L17 7M7 7h10v10" />;
    case "arrow-right":     return <Icon d="M5 12h14M12 5l7 7-7 7" />;
    case "arrow-left":      return <Icon d="M19 12H5M12 19l-7-7 7-7" />;
    case "chevron-right":   return <Icon d="M9 18l6-6-6-6" />;
    case "chevron-down":    return <Icon d="M6 9l6 6 6-6" />;
    case "external-link":   return <Icon d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" d2="M15 3h6v6M10 14L21 3" />;

    /* ── People & Users ── */
    case "user":            return <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" d2="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;
    case "users":           return <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" d2="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />;
    case "user-plus":       return <Icon d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" d2="M12.5 7a4 4 0 1 0 0-4M20 8v6M23 11h-6" />;
    case "user-check":      return <Icon d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" d2="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4" />;
    case "person-pin":      return <Icon d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" d2="M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />;
    case "team":            return <Icon d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17 21v-2a3 3 0 0 0-3-3H10a3 3 0 0 0-3 3v2" d2="M20 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM23 19v-1.5a2 2 0 0 0-2-2h-1.5M4 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 19v-1.5a2 2 0 0 0 2-2H4.5" />;
    case "contact":         return <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" d2="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 3h2M16 7h2M16 11h2" />;
    case "face":            return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />;

    /* ── Work & Tasks ── */
    case "briefcase":       return <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />;
    case "clipboard":       return <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />;
    case "checklist":       return <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" d2="M9 12l2 2 4-4" />;
    case "check":           return <Icon d="M20 6L9 17l-5-5" />;
    case "check-circle":    return <Icon d="M22 11.08V12a10 10 0 1 1-5.93-9.14" d2="M22 4L12 14.01l-3-3" />;
    case "task":            return <Icon d="M9 11l3 3L22 4" d2="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />;
    case "list":            return <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
    case "list-ordered":    return <Icon d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />;
    case "list-checks":     return <Icon d="M3 5l2 2 4-4M3 12l2 2 4-4M3 19l2 2 4-4M13 6h8M13 12h8M13 19h8" />;
    case "kanban":          return <Icon d="M6 3h4v12H6zM14 3h4v8h-4zM6 19h4v2H6zM14 15h4v6h-4z" />;
    case "sprint":          return <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />;
    case "milestone":       return <Icon d="M18 6H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h13l4-3.5L18 6z" d2="M12 12v9" />;
    case "roadmap":         return <Icon d="M3 6l9-4 9 4v12l-9 4-9-4V6z" />;
    case "backlog":         return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" d2="M12 6v6l4 2" />;
    case "inbox":           return <Icon d="M22 12h-6l-2 3h-4l-2-3H2" d2="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />;
    case "archive":         return <Icon d="M21 8v13H3V8" d2="M23 3H1v5h22V3zM10 12h4" />;
    case "drag":            return <Icon d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />;

    /* ── Planning & Strategy ── */
    case "star":            return <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;
    case "target":          return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />;
    case "flag":            return <Icon d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" d2="M4 22v-7" />;
    case "flag-check":      return <Icon d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" d2="M4 22v-7M9 8l2 2 4-4" />;
    case "calendar":        return <Icon d="M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" d2="M16 2v4M8 2v4M3 10h18" />;
    case "calendar-check":  return <Icon d="M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" d2="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" />;
    case "clock":           return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 6v6l4 2" />;
    case "timer":           return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 6v6l3 3M9.5 3h5" />;
    case "timeline":        return <Icon d="M3 12h18" d2="M3 6h18M3 18h18M12 2v4M12 18v4M6 6l-3 3 3 3M18 6l3 3-3 3" />;
    case "gantt":           return <Icon d="M3 5h8M3 9h14M3 13h10M3 17h6M3 21h12" />;
    case "chart-bar":       return <Icon d="M18 20V10M12 20V4M6 20v-6" />;
    case "chart-line":      return <Icon d="M3 3v18h18" d2="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />;
    case "trend-up":        return <Icon d="M23 6l-9.5 9.5-5-5L1 18" d2="M17 6h6v6" />;
    case "activity":        return <Icon d="M22 12h-4l-3 9L9 3l-3 9H2" />;
    case "layers":          return <Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;

    /* ── Portfolio & Projects ── */
    case "folder":          return <Icon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />;
    case "folder-open":     return <Icon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" d2="M2 10h20" />;
    case "folder-plus":     return <Icon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" d2="M12 11v6M9 14h6" />;
    case "package":         return <Icon d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />;
    case "grid":            return <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />;
    case "layout":          return <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" d2="M3 9h18M9 21V9" />;
    case "apps":            return <Icon d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z" />;
    case "sitemap":         return <Icon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" d2="M7 12h10M12 7v10" />;
    case "hierarchy":       return <Icon d="M10 3H3v7h7V3zM21 3h-7v7h7V3zM21 14h-7v7h7v-7zM10 14H3v7h7v-7z" />;
    case "git-branch":      return <Icon d="M6 3v12" d2="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" />;
    case "git-merge":       return <Icon d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9c0 3.31 2.69 6 6 6h3" d2="M6 9v6" />;

    /* ── Settings & Config ── */
    case "cog":             return <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" d2="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />;
    case "sliders":         return <Icon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />;
    case "wrench":          return <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    case "tool":            return <Icon d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />;
    case "filter":          return <Icon d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />;
    case "sort":            return <Icon d="M3 6h18M6 12h12M9 18h6" />;
    case "search":          return <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" d2="M21 21l-4.35-4.35" />;
    case "zoom-in":         return <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" d2="M21 21l-4.35-4.35M11 8v6M8 11h6" />;
    case "adjust":          return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 2a10 10 0 0 1 0 20" />;
    case "toggle":          return <Icon d="M17 7H7a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10z" d2="M17 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />;
    case "lock":            return <Icon d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" d2="M7 11V7a5 5 0 0 1 10 0v4" />;
    case "unlock":          return <Icon d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" d2="M7 11V7a5 5 0 1 1 9.9-1" />;
    case "key":             return <Icon d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />;
    case "shield":          return <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case "eye":             return <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" d2="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "eye-off":         return <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" d2="M1 1l22 22" />;

    /* ── Communication ── */
    case "bell":            return <Icon d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" d2="M13.73 21a2 2 0 0 1-3.46 0" />;
    case "bell-off":        return <Icon d="M13.73 21a2 2 0 0 1-3.46 0M18.63 13A17.89 17.89 0 0 1 18 8" d2="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.33-5M1 1l22 22" />;
    case "message":         return <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    case "message-circle":  return <Icon d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />;
    case "mail":            return <Icon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" d2="M22 6l-10 7L2 6" />;
    case "send":            return <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />;
    case "phone":           return <Icon d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.23h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.29 6.29l.75-.75a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />;
    case "share":           return <Icon d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" d2="M16 6l-4-4-4 4M12 2v13" />;
    case "link":            return <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" d2="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />;
    case "link-off":        return <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71M2 2l20 20" />;
    case "campaign":        return <Icon d="M3 11l19-9-9 19-2-8-8-2z" />;
    case "rss":             return <Icon d="M4 11a9 9 0 0 1 9 9" d2="M4 4a16 16 0 0 1 16 16M5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />;

    /* ── Data & Analytics ── */
    case "database":        return <Icon d="M12 2C6.48 2 2 4.24 2 7s4.48 5 10 5 10-2.24 10-5-4.48-5-10-5z" d2="M2 7v5c0 2.76 4.48 5 10 5s10-2.24 10-5V7M2 12v5c0 2.76 4.48 5 10 5s10-2.24 10-5v-5" />;
    case "server":          return <Icon d="M2 3h20v6H2zM2 15h20v6H2z" d2="M6 6h.01M6 18h.01" />;
    case "hard-drive":      return <Icon d="M22 12H2" d2="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01" />;
    case "cpu":             return <Icon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />;
    case "pie-chart":       return <Icon d="M21.21 15.89A10 10 0 1 1 8 2.83" d2="M22 12A10 10 0 0 0 12 2v10z" />;
    case "bar-chart":       return <Icon d="M12 20V10M18 20V4M6 20v-4" />;
    case "table":           return <Icon d="M3 3h18v18H3z" d2="M3 9h18M3 15h18M9 3v18M15 3v18" />;
    case "scan":            return <Icon d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />;
    case "binary":          return <Icon d="M6 3v18M18 3v18M2 9h4M18 9h4M2 15h4M18 15h4M10 3v6l2-3M10 12v6l2-3" />;
    case "hash":            return <Icon d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />;
    case "percent":         return <Icon d="M19 5L5 19M6.5 6.5h.01M17.5 17.5h.01M9 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15 22.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />;
    case "lan":             return <Icon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18M3 9h18" />;

    /* ── Documents & Content ── */
    case "file":            return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M16 13H8M16 17H8M10 9H8" />;
    case "file-text":       return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M16 13H8M16 17H8M10 9H8" />;
    case "file-plus":       return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M12 18v-6M9 15h6" />;
    case "file-check":      return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M9 15l2 2 4-4" />;
    case "book":            return <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" d2="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />;
    case "book-open":       return <Icon d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" d2="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />;
    case "bookmark":        return <Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />;
    case "tag":             return <Icon d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" d2="M7 7h.01" />;
    case "label":           return <Icon d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" />;
    case "paste":           return <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />;
    case "cut":             return <Icon d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" d2="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "indent":          return <Icon d="M3 6h18M3 12h12M3 18h18M17 9l4 3-4 3V9z" />;
    case "align-left":      return <Icon d="M17 10H3M21 6H3M21 14H3M17 18H3" />;
    case "type":            return <Icon d="M4 7V4h16v3M9 20h6M12 4v16" />;
    case "code":            return <Icon d="M16 18l6-6-6-6M8 6l-6 6 6 6" />;
    case "terminal":        return <Icon d="M4 17l6-6-6-6M12 19h8" />;

    /* ── Media & Design ── */
    case "image":           return <Icon d="M21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h4l2 3h3a2 2 0 0 1 2 2z" d2="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "camera":          return <Icon d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" d2="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;
    case "video":           return <Icon d="M23 7l-7 5 7 5V7z" d2="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />;
    case "music":           return <Icon d="M9 18V5l12-2v13" d2="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "mic":             return <Icon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" d2="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />;
    case "palette":         return <Icon d="M12 22a10 10 0 0 1-9.95-9A10 10 0 0 1 12 2c5.52 0 10 4.03 10 9a5 5 0 0 1-5 5h-1.8a2 2 0 0 0-1.8 2.8A2 2 0 0 1 12 22z" d2="M8 10h.01M12 10h.01M16 10h.01" />;
    case "pencil":          return <Icon d="M12 20h9" d2="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />;
    case "pen":             return <Icon d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />;
    case "crop":            return <Icon d="M6.13 1L6 16a2 2 0 0 0 2 2h15" d2="M1 6.13l15-.13a2 2 0 0 1 2 2v15" />;
    case "layers-alt":      return <Icon d="M12 2L2 7l10 5 10-5-10-5z" d2="M2 17l10 5 10-5M2 12l10 5 10-5" />;

    /* ── Finance & Business ── */
    case "dollar":          return <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />;
    case "credit-card":     return <Icon d="M1 4h22v16H1z" d2="M1 10h22" />;
    case "shopping":        return <Icon d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" d2="M3 6h18M16 10a4 4 0 0 1-8 0" />;
    case "box":             return <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />;
    case "truck":           return <Icon d="M1 3h15v13H1z" d2="M16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />;
    case "building":        return <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />;
    case "office":          return <Icon d="M6 3h12v18H6z" d2="M9 7h1M9 11h1M9 15h1M14 7h1M14 11h1M14 15h1M10 21v-4h4v4" />;
    case "corporate":       return <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" d2="M7 8h10M7 12h10M7 16h10" />;

    /* ── Status & Alerts ── */
    case "warning":         return <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" d2="M12 9v4M12 17h.01" />;
    case "alert-circle":    return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 8v4M12 16h.01" />;
    case "alert-octagon":   return <Icon d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" d2="M12 8v4M12 16h.01" />;
    case "crisis":          return <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" d2="M12 9v4M12 17h.01M4 22L20 2" />;
    case "info":            return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 16v-4M12 8h.01" />;
    case "help":            return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />;
    case "block":           return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M4.93 4.93l14.14 14.14" />;
    case "x-circle":        return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M15 9l-6 6M9 9l6 6" />;
    case "minus-circle":    return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M8 12h8" />;
    case "plus-circle":     return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 8v8M8 12h8" />;

    /* ── Actions ── */
    case "play":            return <Icon d="M5 3l14 9-14 9V3z" />;
    case "pause":           return <Icon d="M6 4h4v16H6zM14 4h4v16h-4z" />;
    case "stop":            return <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />;
    case "refresh":         return <Icon d="M1 4v6h6M23 20v-6h-6" d2="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />;
    case "auto-mode":       return <Icon d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />;
    case "upload":          return <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" d2="M17 8l-5-5-5 5M12 3v12" />;
    case "download":        return <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" d2="M7 10l5 5 5-5M12 15V3" />;
    case "plus":            return <Icon d="M12 5v14M5 12h14" />;
    case "minus":           return <Icon d="M5 12h14" />;
    case "x":               return <Icon d="M18 6L6 18M6 6l12 12" />;
    case "trash":           return <Icon d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" d2="M10 11v6M14 11v6" />;
    case "edit":            return <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" d2="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />;
    case "copy":            return <Icon d="M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z" d2="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />;
    case "move":            return <Icon d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />;
    case "compress":        return <Icon d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />;
    case "expand":          return <Icon d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />;
    case "merge":           return <Icon d="M8 6v6c0 3.31 2.69 6 6 6h1M6 3L8 6l-2 3" d2="M16 3l2 3-2 3M18 9h-3" />;
    case "split":           return <Icon d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />;

    /* ── Infrastructure & Tech ── */
    case "computer":        return <Icon d="M2 3h20v13H2z" d2="M8 21h8M12 16v5" />;
    case "laptop":          return <Icon d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9" d2="M1 16h22" />;
    case "smartphone":      return <Icon d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" d2="M12 18h.01" />;
    case "cloud":           return <Icon d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />;
    case "cloud-upload":    return <Icon d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" d2="M12 12v9M9 15l3-3 3 3" />;
    case "wifi":            return <Icon d="M5 12.55a11 11 0 0 1 14.08 0" d2="M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />;
    case "cable":           return <Icon d="M4 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2z" d2="M3 5V3M7 5V3M9 9h2l3 3h6" />;
    case "login":           return <Icon d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" d2="M10 17l5-5-5-5M15 12H3" />;
    case "logout":          return <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" d2="M16 17l5-5-5-5M21 12H9" />;
    case "api":             return <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
    case "webhook":         return <Icon d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2M6 5.03V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M14.5 16.5l2 3.5" d2="M14 4h-4M10 7l-2-3M17.5 7.5a5 5 0 1 1-7.78 6.24" />;

    /* ── Misc & Utility ── */
    case "sparkle":         return <Icon d="M12 3l1.88 5.76L20 10l-6.12 1.24L12 17l-1.88-5.76L4 10l6.12-1.24L12 3z" />;
    case "zap":             return <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />;
    case "sun":             return <Icon d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" d2="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />;
    case "moon":            return <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
    case "globe":           return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />;
    case "language":        return <Icon d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />;
    case "scale":           return <Icon d="M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" d2="M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h18" />;
    case "accessibility":   return <Icon d="M17 7l-5 5-5-5M7 12l5 5 5-5" />;
    case "focus":           return <Icon d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" d2="M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0" />;
    case "maximize":        return <Icon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />;
    case "minimize":        return <Icon d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />;
    case "linear-scale":    return <Icon d="M3 12h18M3 6l9 6 9-6" />;
    case "density-large":   return <Icon d="M3 6h18M3 12h18M3 18h18" />;
    case "density-small":   return <Icon d="M3 4h18M3 8h18M3 12h18M3 16h18M3 20h18" />;
    case "favorite":        return <Icon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />;
    case "location":        return <Icon d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" d2="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
    case "location-search": return <Icon d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" d2="M12 7v6M9 10h6" />;

    /* ── Navigation extended ── */
    case "arrow-down":       return <Icon d="M12 5v14M19 12l-7 7-7-7" />;
    case "arrow-up":         return <Icon d="M12 19V5M5 12l7-7 7 7" />;
    case "corner-up-right":  return <Icon d="M15 14l5-5-5-5" d2="M4 20v-7a4 4 0 0 1 4-4h12" />;
    case "corner-down-right":return <Icon d="M15 10l5 5-5 5" d2="M4 4v7a4 4 0 0 0 4 4h12" />;
    case "skip-back":        return <Icon d="M19 20L9 12l10-8v16z" d2="M5 19V5" />;
    case "skip-forward":     return <Icon d="M5 4l10 8-10 8V4z" d2="M19 5v14" />;
    case "rewind":           return <Icon d="M11 19L1 12l10-7v14z" d2="M23 19L13 12l10-7v14z" />;
    case "fast-forward":     return <Icon d="M13 19l10-7-10-7v14z" d2="M1 19l10-7L1 5v14z" />;

    /* ── People extended ── */
    case "user-x":           return <Icon d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" d2="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM18 8l4 4M22 8l-4 4" />;
    case "user-minus":       return <Icon d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" d2="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 11h-6" />;
    case "award":            return <Icon d="M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" d2="M8.21 13.89L7 23l5-3 5 3-1.21-9.12" />;
    case "badge":            return <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;
    case "id-card":          return <Icon d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" d2="M8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM14 9h4M14 13h4" />;
    case "briefcase-check":  return <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M9 14l2 2 4-4" />;

    /* ── Work & Tasks extended ── */
    case "sticky-note":      return <Icon d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z" d2="M15 3v6h6" />;
    case "note":             return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M16 17H8M16 13H8" />;
    case "comment":          return <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    case "layers-check":     return <Icon d="M12 2L2 7l10 5 10-5-10-5z" d2="M2 17l10 5 10-5M2 12l10 5 10-5M7 22l2 2 5-5" />;
    case "priority-high":    return <Icon d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />;
    case "priority-med":     return <Icon d="M3 8h18M3 12h18M3 16h12" />;
    case "priority-low":     return <Icon d="M3 10h18M3 14h12" />;
    case "blocked":          return <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" d2="M12 9v4M12 17h.01M3 3l18 18" />;
    case "recurring":        return <Icon d="M17 1l4 4-4 4" d2="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />;
    case "dependencies":     return <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" d2="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM12 12v4M10 14h4" />;

    /* ── Planning & Strategy extended ── */
    case "chart-area":       return <Icon d="M3 3v18h18" d2="M7 16l4-8 4 8 4-4" />;
    case "chart-scatter":    return <Icon d="M3 3v18h18" d2="M7 12h.01M11 6h.01M15 14h.01M19 9h.01M8 18h.01" />;
    case "report":           return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M8 13h8M8 17h5M8 9h2" />;
    case "forecast":         return <Icon d="M3 3v18h18" d2="M7 14l4-4 4 4 4-4" />;
    case "kpi":              return <Icon d="M12 20V10M18 20V4M6 20v-4" />;
    case "velocity":         return <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />;
    case "compass-rose":     return <Icon d="M12 2v20M2 12h20" d2="M12 2l3 10-3 10-3-10z" />;
    case "telescope":        return <Icon d="M10 10l-6.5 6.5a2.12 2.12 0 0 0 3 3L13 13" d2="M14 10h1a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-1M12 12l4 4" />;
    case "binoculars":       return <Icon d="M10 6H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-8zM14 6h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4V6zM10 12h4" />;

    /* ── Portfolio & Projects extended ── */
    case "diagram":          return <Icon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" d2="M9 9h6v6H9z" />;
    case "network":          return <Icon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18M12 9v12M9 12h6" />;
    case "flow":             return <Icon d="M5 12h14" d2="M12 5l7 7-7 7M5 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />;
    case "collection":       return <Icon d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10" />;
    case "template":         return <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" d2="M3 9h18M9 21V9" />;
    case "workspace":        return <Icon d="M3 3h7v7H3z" d2="M14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />;
    case "kanban-board":     return <Icon d="M3 3h5v18H3zM10 3h5v12h-5zM17 3h4v7h-4z" />;
    case "tree":             return <Icon d="M12 3v18" d2="M12 8H7a2 2 0 0 0-2 2v2M12 8h5a2 2 0 0 1 2 2v2M12 14H7a2 2 0 0 0-2 2v2M12 14h5a2 2 0 0 1 2 2v2" />;
    case "mindmap":          return <Icon d="M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0" d2="M12 9V5M15 11l3-3M15 13l3 3M12 15v4M9 13l-3 3M9 11l-3-3" />;

    /* ── Settings & Config extended ── */
    case "cog-play":         return <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" d2="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />;
    case "terminal-square":  return <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" d2="M8 9l3 3-3 3M13 15h3" />;
    case "switch":           return <Icon d="M16 3l4 4-4 4" d2="M20 7H4M8 21l-4-4 4-4M4 17h16" />;
    case "equalizer":        return <Icon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />;
    case "palette-swatch":   return <Icon d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10H4a2 2 0 0 1-2-2v-7.93z" d2="M8 16h.01M12 16h.01M16 12h.01M16 8h.01" />;
    case "magic":            return <Icon d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19.2 13.2M17.8 6.2L19.2 4.8M3 21L12 12M12.2 6.2L10.8 4.8" />;

    /* ── Communication extended ── */
    case "at-sign":          return <Icon d="M20 12a8 8 0 1 0-3.56 6.6" d2="M20 12v2a2 2 0 0 0 4 0v-2a10 10 0 1 0-3.43 7.5" />;
    case "inbox-arrow":      return <Icon d="M22 12h-6l-2 3h-4l-2-3H2" d2="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM12 7v6M9 10l3 3 3-3" />;
    case "broadcast":        return <Icon d="M18.36 5.64a9 9 0 0 1 0 12.72" d2="M5.64 5.64a9 9 0 0 0 0 12.72M8.46 8.46a5 5 0 0 0 0 7.07M15.54 8.46a5 5 0 0 1 0 7.07M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0" />;
    case "chat-dots":        return <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" d2="M8 10h.01M12 10h.01M16 10h.01" />;
    case "reply":            return <Icon d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" d2="M15 20l-5-5 5-5" />;
    case "forward-msg":      return <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 0 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 0 1-6 0v-1m6 0H9" />;

    /* ── Data & Analytics extended ── */
    case "funnel":           return <Icon d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />;
    case "sigma":            return <Icon d="M18 7V4H6l6 8-6 8h12v-3" />;
    case "function":         return <Icon d="M15 5H7a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1c2 0 2 4 0 4H7" d2="M15 19h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-1" />;
    case "variable":         return <Icon d="M8 4l8 16M16 4L8 20" />;
    case "regex":            return <Icon d="M12 6v6M9 9l6 6M15 9l-6 6M4 20h3l3-8M14 20l3-8 3 8M4 16h6" />;
    case "schema":           return <Icon d="M10 3H3v7h7V3zM21 3h-7v7h7V3zM21 14h-7v7h7v-7zM10 14H3v7h7v-7z" />;
    case "query":            return <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" d2="M21 21l-4.35-4.35M8 11h6M11 8v6" />;
    case "api-key":          return <Icon d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />;

    /* ── Documents & Content extended ── */
    case "file-code":        return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" />;
    case "file-lock":        return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M8 17h8M12 10a2 2 0 0 0-2 2v3h4v-3a2 2 0 0 0-2-2z" />;
    case "file-search":      return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M10 13a2 2 0 1 0 4 0 2 2 0 0 0-4 0M16 17l-1.5-1.5" />;
    case "newspaper":        return <Icon d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" d2="M18 14h-8M15 18h-5M10 6h8v4h-8z" />;
    case "draft":            return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M12 18v-6M9 15h6" />;
    case "archive-box":      return <Icon d="M21 8v13H3V8" d2="M23 3H1v5h22V3zM10 12h4" />;
    case "changelog":        return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M8 13h8M8 17h8M8 9h2" />;

    /* ── Media & Design extended ── */
    case "brush":            return <Icon d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" d2="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1 1 2.25 2.02 3.98 2.02 2.23 0 4.01-1.8 4.01-4.04a3.01 3.01 0 0 0-3-3.02z" />;
    case "eraser":           return <Icon d="M20 20H7L3 16l12.5-12.5a2.12 2.12 0 0 1 3 3L7 18" d2="M6 17l1-1" />;
    case "ruler":            return <Icon d="M5 3l14 14M3 5l2-2M7 9L5 7M11 13l-2-2M15 17l-2-2M19 21l2-2M9 3l12 12M21 7l-2 2M17 3l2 2M13 7l2-2M9 11l2-2M5 15l2-2M3 19l2-2" />;
    case "vector-pen":       return <Icon d="M12 3L4 15h16L12 3z" d2="M8 15v6M16 15v6M8 21h8" />;
    case "color-fill":       return <Icon d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78L19 11z" d2="M20 23q0-3 2-3t2 3M2 2l20 20" />;
    case "contrast":         return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 2v20" />;
    case "artboard":         return <Icon d="M2 2h4M18 2h4M2 20h4M18 20h4M5 2v4M5 18v4M19 2v4M19 18v4M8 8h8v8H8z" />;

    /* ── Finance & Business extended ── */
    case "coin":             return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M12 6v6M12 15h.01" />;
    case "bank":             return <Icon d="M3 22h18M6 18V9M10 18V9M14 18V9M18 18V9M2 9l10-6 10 6H2z" />;
    case "invoice":          return <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" d2="M14 2v6h6M9 15h6M9 11h6M9 7h3" />;
    case "receipt":          return <Icon d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" d2="M8 9h8M8 13h6" />;
    case "warehouse":        return <Icon d="M2 3h20v7H2z" d2="M4 10v11M20 10v11M4 21h16M9 10v4M15 10v4" />;
    case "growth":           return <Icon d="M23 6l-9.5 9.5-5-5L1 18" d2="M17 6h6v6" />;
    case "contract":         return <Icon d="M4 2h12l4 4v16H4V2z" d2="M14 2v4h4M8 9h8M8 13h8M8 17h4" />;

    /* ── Status & Alerts extended ── */
    case "pulse":            return <Icon d="M22 12h-4l-3 9L9 3l-3 9H2" />;
    case "dot":              return <Icon d="M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0" />;
    case "circle-check":     return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" d2="M9 12l2 2 4-4" />;
    case "status-online":    return <Icon d="M5.636 5.636a9 9 0 1 0 12.728 0" />;
    case "status-off":       return <Icon d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.69 12.69M12 2v4" d2="M2 2l20 20" />;
    case "version":          return <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" d2="M12 8v4l3 3" />;

    /* ── Actions extended ── */
    case "undo":             return <Icon d="M3 7v6h6" d2="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />;
    case "redo":             return <Icon d="M21 7v6h-6" d2="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />;
    case "cut-action":       return <Icon d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" d2="M20 4L8.12 15.88M15.88 15.88L20 20M8.12 8.12L12 12" />;
    case "import":           return <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" d2="M17 8l-5 5-5-5M12 13V3" />;
    case "export":           return <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" d2="M7 10l5-5 5 5M12 5v12" />;
    case "save":             return <Icon d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" d2="M17 21v-8H7v8M7 3v5h8" />;
    case "print":            return <Icon d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" d2="M6 14h12v8H6z" />;
    case "restore":          return <Icon d="M1 4v6h6" d2="M3.51 15a9 9 0 1 0 .49-3.5" />;
    case "purge":            return <Icon d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />;

    /* ── Infrastructure & Tech extended ── */
    case "docker":           return <Icon d="M22 12.5c-.26-1.6-1.67-2.68-3.37-2.68h-.54a4.5 4.5 0 0 0-8.18 0h-.54C7.67 9.82 6.26 10.9 6 12.5" d2="M2 12.5h20M6 12.5v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4" />;
    case "kubernetes":       return <Icon d="M12 2l9 5v10l-9 5-9-5V7z" d2="M12 7v10M7 9.5l5 2.5 5-2.5" />;
    case "git-commit":       return <Icon d="M1 12h7M16 12h7" d2="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />;
    case "git-pull":         return <Icon d="M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM13 6h3a2 2 0 0 1 2 2v7" d2="M6 9v12" />;
    case "code-fork":        return <Icon d="M7 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 11v8M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 17c0-2.21 4.48-4 10-4" />;
    case "monitor":          return <Icon d="M20 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" d2="M8 21h8M12 17v4" />;
    case "desktop-tower":    return <Icon d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4M8 7h2M8 11h2M14 7h2M14 11h2" />;
    case "storage":          return <Icon d="M2 8h20v8H2zM2 4h20v4H2z" d2="M6 12h.01M10 12h.01M6 8h.01M10 8h.01" />;
    case "pipeline":         return <Icon d="M2 9h20M2 15h20M9 3L3 9M15 3l-6 6M15 21l6-6M9 21l6-6" />;

    /* ── Misc & Utility extended ── */
    case "QR":               return <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" d2="M14 14h.01M14 18h.01M18 14h.01M18 18h.01M21 14v3M21 18v3" />;
    case "barcode":          return <Icon d="M3 3h2v18H3zM8 3h1v18H8zM11 3h2v18h-2zM15 3h1v18h-1zM18 3h1v18h-1zM21 3h2v18h-2z" />;
    case "fingerprint":      return <Icon d="M12 10a2 2 0 0 0-2 2v1M10 16a12.5 12.5 0 0 1-.28-3.16A2 2 0 0 1 12 11.5" d2="M14 13.5c0 1.5-.22 3-.66 4.5M5.07 8A10 10 0 0 1 22 12c0 1.5-.18 2.96-.52 4.37M5.04 12.29A10 10 0 0 0 7 19" />;
    case "swap":             return <Icon d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />;
    case "sort-asc":         return <Icon d="M3 6h18M3 12h12M3 18h6M15 9l3-3 3 3M18 6v12" />;
    case "sort-desc":        return <Icon d="M3 6h6M3 12h12M3 18h18M15 15l3 3 3-3M18 18V6" />;
    case "tag-multiple":     return <Icon d="M17 3H7a2 2 0 0 0-2 2v16l7-4 7 4V5a2 2 0 0 0-2-2z" d2="M12 3v13" />;
    case "fire":             return <Icon d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />;
    case "snowflake":        return <Icon d="M12 2v20M2 12h20M4.22 4.22l15.56 15.56M19.78 4.22L4.22 19.78" />;
    case "diamond":          return <Icon d="M12 2L2 9l10 13 10-13z" d2="M2 9h20M7.5 2l-2 7M16.5 2l2 7" />;
    case "hourglass":        return <Icon d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />;
    case "infinity":         return <Icon d="M12 12c-2-2.5-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.5 6-4z" d2="M12 12c2 2.5 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.5-6 4z" />;

    default:                return <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />;
  }
}
