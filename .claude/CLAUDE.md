# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

- **Styling / CSS / new UI components** → read [`docs/css-guide.md`](../docs/css-guide.md) before writing or modifying styles. BEM-lite naming, no inline styles, no Tailwind, no CSS-in-JS. All rules live in `app/globals.css`.

## Custom Commands

### npmrun
When the user writes **`<npmrun>`**, prompt to run the dev server:
```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ PM && npm run dev
```

This starts the Next.js development server on `http://localhost:3000`.

## Section Shortcuts

### `<user>`
The shipped product — what customers see. Includes all user-facing features, role-based access (user, padmin, gadmin), and the main app UI.

**Location:** `app/(user)/` route group

### `<gadmin>`
Global admin controls. Superusers manage tenants, delegate scopes to product admins, and configure system-wide settings (SSO/LDAP, custom fields, workflows).

**Location:** Admin section within `<user>` app (role-gated)

### `<padmin>`
Product admin — role-based access within `<user>`. Product Leads manage their assigned portfolios and projects with permissions delegated by `<gadmin>`.

**Location:** Admin section within `<user>` app (role-gated)

### `<dev>`
Ringfenced dev tooling. Completely independent folder with its own services, APIs, styles, and components. Embedded as a plug-and-play plugin in `<user>` via code reference. Detachable without touching core product.

**Location:** `dev/` folder (separate from app)
