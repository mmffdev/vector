"use client";

// Reusable body for the /workspace-admin/custom-fields surface.
// Lives outside app/(user)/... so both the list page (page.tsx) and the
// /[id] deep-link route can mount it.
//
// Next.js restricts named exports from page.tsx files to a known set
// (default + metadata/config/generateStaticParams + a few more); a
// reusable component is not in that allow-list, so the body lives here.

import { useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useSentinel } from "@/app/sentinel";
import ObjectTree from "@/app/components/ObjectTreeV2/p_ObjectTree";
import { createCustomFieldsAdapter } from "@/app/components/ObjectTreeV2/adapters/customFieldsAdapter";
import customFieldsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_custom_fields.json";
import { resolveWizardConfig } from "@/app/lib/wizardLoader";
import type { WorkspaceField } from "@/app/lib/fieldsApi";
import { FormBuilderLaunchPanel } from "@/app/components/FormLayoutBuilder/FormBuilderLaunchPanel";

export function CustomFieldsPageBody({
  initialOpenId,
  initialCreateMode,
}: {
  initialOpenId?: string | null;
  initialCreateMode?: boolean;
}) {
  const { full } = usePageTitle();
  const { sentinel_user } = useSentinel();
  const activeWorkspaceId = sentinel_user?.workspace_id ?? null;

  const wizardConfig = useMemo(() => {
    const base = resolveWizardConfig(
      customFieldsWizardJson as unknown as Record<string, unknown>,
    );
    // Interpolate the {workspace_id} template the sidecar carries.
    // OTV2's useObjectTreeWindow fetches base.resourceUrl literally; the
    // template substitution is the host's responsibility because OTV2 is
    // row-type agnostic and shouldn't know about workspace ids.
    const resourceUrl = (base.resourceUrl ?? "")
      .replace("{workspace_id}", activeWorkspaceId ?? "");
    return { ...base, resourceUrl };
  }, [activeWorkspaceId]);

  const adapter = useMemo(
    () => activeWorkspaceId
      ? createCustomFieldsAdapter({ workspaceId: activeWorkspaceId })
      : null,
    [activeWorkspaceId],
  );

  if (!activeWorkspaceId || !adapter) {
    return (
      <PageContent>
        <PageHeading level={1} title={full} subtitle="Loading workspace…" />
      </PageContent>
    );
  }

  return (
    <PageContent>
      <FormBuilderLaunchPanel />
      <ObjectTree<WorkspaceField>
        title="Custom Fields"
        addressableName="custom_fields_grid"
        showHeader={false}
        wizardConfig={wizardConfig as Parameters<typeof ObjectTree>[0]["wizardConfig"]}
        adapter={adapter}
        selectedId={initialOpenId ?? null}
        initialCreateFlyoutOpen={initialCreateMode}
        hideCogMenu
        onSelect={() => { /* selection handled inside OTV2 via adapter flyout */ }}
      />
    </PageContent>
  );
}
