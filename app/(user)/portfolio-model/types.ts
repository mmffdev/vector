// Shared types for the portfolio-model route. Extracted so sibling
// modules (LayersPreviewTable) can import them without forming a cycle
// with page.tsx, which imports the table.

export interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
  is_placeholder?: boolean;
}
