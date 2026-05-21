import TabBar from "@/app/components/TabBar";

const TABS = [
  { key: "notifications", label: "Notifications", href: "/user/notifications/notifications" },
  { key: "settings",      label: "Settings",      href: "/user/notifications/settings"      },
];

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabBar tabs={TABS} ariaLabel="Notifications sections" />
      {children}
    </>
  );
}
