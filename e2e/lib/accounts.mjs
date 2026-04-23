// Local dev test accounts. Mirrors saved memory `dev_accounts.md`.
// Keep in sync if passwords rotate.
export const ACCOUNTS = {
  user:   { email: "user@mmffdev.com",   password: "SecureCsrf2026!" },
  padmin: { email: "padmin@mmffdev.com", password: "myApples100@@" },
  gadmin: { email: "gadmin@mmffdev.com", password: "myApples27@" },
};

export function accountFor(role) {
  const a = ACCOUNTS[role];
  if (!a) throw new Error(`unknown role: ${role}`);
  return a;
}
