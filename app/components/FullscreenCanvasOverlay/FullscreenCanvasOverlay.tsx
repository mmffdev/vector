/**
 * DEPRECATED — use `Canvas` from `app/components/Canvas/Canvas.tsx`.
 *
 * This file is now a thin back-compat re-export. The component was
 * promoted to a reusable primitive (`Canvas`) that owns the chrome
 * (logo, title, swap button, close button) and the sidebar-collapse
 * animation. Migrate call-sites to `Canvas` and delete this file once
 * no consumers remain.
 *
 * Prop names are aliased one-for-one with one rename: callers that
 * passed `children` (canvas body) now pass `primaryView`. A second
 * canvas body can be supplied via `alternateView` to opt into the
 * built-in swap button.
 */
export type {
  CanvasStatus as FullscreenCanvasOverlayStatus,
  CanvasProps as FullscreenCanvasOverlayProps,
} from "@/app/components/Canvas/Canvas";
export { Canvas as FullscreenCanvasOverlay } from "@/app/components/Canvas/Canvas";
