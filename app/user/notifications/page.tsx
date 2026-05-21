import { redirect } from "next/navigation";

// /user/notifications resolves to its default tab. The avatar-bucket nav
// entry (pages.href) stays /user/notifications so this single href keeps
// landing in the right place even when the default tab changes.
export default function NotificationsIndex() {
  redirect("/user/notifications/notifications");
}
