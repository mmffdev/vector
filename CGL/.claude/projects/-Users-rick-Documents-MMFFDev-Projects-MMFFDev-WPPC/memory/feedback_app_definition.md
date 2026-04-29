---
name: App definition — what qualifies as an app
description: Apps are self-contained dynamic modules inside pages, not static chrome or layout patterns
type: feedback
originSessionId: 054f895e-0ce1-441e-a571-c177a1542f87
---
Apps are self-contained modules added to pages that output dynamic data or provide interactive tools. They are smaller apps running inside the main app.

**IS an app:** Port Allocation, Heartbeat, System Parity, Stat Boxes, Container Timeline (planned), any future visualisation/tool module.

**NOT an app:** Header bar, sidebar, footer, page titles, accordion layout, filter bars, navigation — these are static chrome or layout patterns.

**Why:** The `app-*` CSS class prefix (applications.css) and `app-section/app-header/app-block` patterns should only be used by self-contained dynamic modules, not by page structure or navigation elements.

**How to apply:** When creating new features, ask: "Does this fetch its own data and render independently?" If yes → app. If it's layout/chrome → use design-system.css or page-specific CSS.
