import PageShell from "@/app/components/PageShell";

export default function Dashboard() {
  return (
    <PageShell title="Dashboard" subtitle="Your workspace overview">
      <div className="empty-state">
        <h3>Welcome to Vector</h3>
        <p>Dashboard widgets and metrics coming soon.</p>
      </div>
    </PageShell>
  );
}
