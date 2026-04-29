---
name: Platform pivot — Docker DevOps Management
description: Sprint 009 pivot from WordPress Plugin Project Creator to generic Docker DevOps Management Platform. WordPress becomes premium sub-feature.
type: project
originSessionId: bc5cd26d-8509-460f-b388-d8b0e7a8daee
---
Platform pivoted in sprint009 (14 April 2026) from "WordPress Plugin Project Creator" (WPPC) to a generic Docker DevOps Management Platform.

**Why:** The tool evolved into a Docker management platform — networking suite, volume browser, log viewer, container grid are all Docker-native features, not WordPress features. WordPress was limiting the ceiling. The market gap is developer-focused Docker landscape management, not another WordPress tool.

**How to apply:**
- WordPress features (wp-config, plugin scaffold, WP debug, WP-CLI) are now premium-only behind paywall
- Free tier: full Docker management for any stack
- Build Wizard being replaced by Project Builder with service selection grid, Docker Hub search, custom image support
- Alpine nettools diagnostics sidecar auto-injected per project network
- All new docs/features should use "Docker DevOps Platform" identity, not "WordPress Plugin Creator"
- Repo name remains WPPC for now (rename is deferred)
- Version bumped to 2.0.0
