---
name: Theme Switching in CSS Updates
description: Always verify CSS changes work with the light/dark theme switcher
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Rule:** Whenever updating `globals.css` or styling, test both light and dark themes before considering the work done.

**Why:** The app has a theme switcher (🌙/☀️ button in topbar) that toggles `data-theme="light"|"dark"` on the root element. CSS variables are scoped to `:root[data-theme="light"]` and `:root[data-theme="dark"]` blocks. A style that looks correct in one theme might be broken, unreadable, or have contrast issues in the other.

**How to apply:** 
- After editing CSS, open the app in browser and switch themes using the button in the topbar
- Verify colors, contrast, borders, and text readability in both light and dark modes
- Pay special attention to new colors, links, buttons, and interactive elements
- If a change affects multiple themes, test both before marking done
