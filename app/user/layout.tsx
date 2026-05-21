// The /user/* route segment shares the same shell, auth gate, and
// context providers as /(user) — it just lives under a literal URL
// segment so the avatar bucket has its own URL namespace. Re-exporting
// the existing layout keeps a single source of truth; if the two ever
// need to diverge, copy the body inline.
export { default } from "@/app/(user)/layout";
