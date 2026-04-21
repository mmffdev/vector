# Section tag shortcuts

When the user writes one of these tags, it refers to the corresponding slice of the product.

## `<user>`
The shipped product — what customers see. All user-facing features, role-based access (user, padmin, gadmin), and the main app UI.

**Location:** `app/(user)/` route group.

## `<gadmin>`
Global admin controls. Superusers manage tenants, delegate scopes to product admins, and configure system-wide settings (SSO/LDAP, custom fields, workflows).

**Location:** Admin section within `<user>` (role-gated).

## `<padmin>`
Product admin — role-based access within `<user>`. Product Leads manage their assigned portfolios and projects with permissions delegated by `<gadmin>`.

**Location:** Admin section within `<user>` (role-gated).

## `<dev>`
Ringfenced dev tooling. Completely independent folder with its own services, APIs, styles, and components. Embedded as a plug-and-play plugin in `<user>` via code reference. Detachable without touching the core product.

**Location:** `dev/` folder (separate from app). See [`dev/README.md`](../dev/README.md) for the mount contract.
