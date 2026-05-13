"use client";

// /risk — risk register. Body uses <Table> (PLA-0015); severity column
// is `kind: "pill"` with HIGH=danger, MEDIUM=warning, LOW=neutral.

import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { usePageTitle } from "@/app/hooks/usePageTitle";

type PillVariant = "success" | "warning" | "danger" | "info" | "neutral";

interface Risk {
  id: string;
  title: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  likelihood: "HIGH" | "MEDIUM" | "LOW";
  owner: string;
  status: string;
  statusVariant: PillVariant;
}

const SEVERITY_VARIANT: Record<Risk["severity"], PillVariant> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const RISKS: Risk[] = [
  {
    id: "RSK-0001",
    title: "Vector rebrand may slip past Q3 deadline",
    severity: "HIGH",
    likelihood: "MEDIUM",
    owner: "R. Cook",
    status: "Mitigating",
    statusVariant: "info",
  },
  {
    id: "RSK-0002",
    title: "Backend SSE timeouts under heavy load",
    severity: "MEDIUM",
    likelihood: "LOW",
    owner: "M. Patel",
    status: "Monitoring",
    statusVariant: "neutral",
  },
  {
    id: "RSK-0003",
    title: "Lime-green leaks back into chart legends",
    severity: "LOW",
    likelihood: "LOW",
    owner: "Design",
    status: "Resolved",
    statusVariant: "success",
  },
];

export default function Risk() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Risk identification, analysis, and mitigation." />
      <Panel
        name="panel_risk_header"
        className="page-panel-heading"
        title="Risk"
        description="Identify, analyse, and track mitigation actions for risks across the workspace."
      />

      <h3 className="eyebrow">Active risks</h3>
      <Table<Risk>
        pageId="risk"
        slot="active_risks"
        ariaLabel="Active risks"
        rows={RISKS}
        rowKey={(r) => r.id}
        columns={[
          { key: "id", header: "ID", width: 110, kind: "mono" },
          { key: "title", header: "Risk" },
          {
            key: "severity",
            header: "Severity",
            width: 110,
            kind: "pill",
            pillVariant: (r) => SEVERITY_VARIANT[r.severity],
            pillLabel: (r) => r.severity,
          },
          {
            key: "likelihood",
            header: "Likelihood",
            width: 120,
            kind: "pill",
            pillVariant: (r) => SEVERITY_VARIANT[r.likelihood],
            pillLabel: (r) => r.likelihood,
          },
          { key: "owner", header: "Owner", width: 140 },
          {
            key: "status",
            header: "Status",
            width: 130,
            kind: "pill",
            pillVariant: (r) => r.statusVariant,
            pillLabel: (r) => r.status,
          },
        ]}
      />
    </PageContent>
  );
}
