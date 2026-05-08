import { apiInfra as api } from "@/app/lib/api";

export type CustomViewKind = "timeline" | "board" | "list";

export interface CustomView {
  id: string;
  label: string;
  kind: CustomViewKind;
  position: number;
  config: Record<string, unknown>;
}

export interface CustomPage {
  id: string;
  label: string;
  icon: string;
  views?: CustomView[];
}

interface ListResp { pages: CustomPage[] }

export async function listCustomPages(): Promise<CustomPage[]> {
  const r = await api<ListResp>("/custom-pages/");
  return r.pages;
}

export function getCustomPage(id: string): Promise<CustomPage> {
  return api<CustomPage>(`/custom-pages/${id}`);
}

export function createCustomPage(label: string, icon = "folder"): Promise<CustomPage> {
  return api<CustomPage>("/custom-pages/", {
    method: "POST",
    body: JSON.stringify({ label, icon }),
  });
}

export function patchCustomPage(
  id: string,
  patch: { label?: string; icon?: string },
): Promise<CustomPage> {
  return api<CustomPage>(`/custom-pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteCustomPage(id: string): Promise<void> {
  await api<void>(`/custom-pages/${id}`, { method: "DELETE" });
}
