import TabBar from "@/app/components/TabBar";

const TABS = [
  { key: "artefact-types",   label: "Artefact Types",   href: "/workspace-admin/artefacts/artefact-types"   },
  { key: "transition-rules", label: "Transition Rules", href: "/workspace-admin/artefacts/transition-rules" },
  { key: "flow-states-v2",   label: "Flow States",      href: "/workspace-admin/artefacts/flow-states-v2"   },
];

export default function ArtefactsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabBar tabs={TABS} ariaLabel="Artefacts sections" />
      {children}
    </>
  );
}
