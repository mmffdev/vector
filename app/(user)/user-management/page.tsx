// B20.4.1 — /user-management is now a tab-bar landing surface (layout.tsx).
// The list page itself moved to /user-management/users/page.tsx. This
// route just bounces to the first tab so nav rail and bookmarks still
// resolve sensibly when the user lands at the bare /user-management URL.
import { redirect } from "next/navigation";

export default function UserManagementPage() {
  redirect("/user-management/users");
}
