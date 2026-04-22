import PageShell from "@/app/components/PageShell";

export default function Favourites() {
  return (
    <PageShell title="Favourites" subtitle="Your starred items">
      <div className="empty-state">
        <h3>Favourites</h3>
        <p>Your favourites list is coming soon.</p>
      </div>
    </PageShell>
  );
}
