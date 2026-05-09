import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { marked } from "marked";

export interface ScopeSection {
  id: string;       // slug, e.g. "1-core-work-item-engine"
  number: string;   // e.g. "1"
  title: string;    // e.g. "Core Work Item Engine"
  html: string;     // rendered section body
}

export interface ScopeDoc {
  meta: { title: string; created: string; updated: string; version: string };
  sections: ScopeSection[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseMeta(raw: string): ScopeDoc["meta"] {
  const get = (label: string) => {
    const m = raw.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`));
    return m ? m[1].trim() : "";
  };
  return {
    title: "Vector — Product Scope & Feature Tracker",
    created: get("Created"),
    updated: get("Last updated"),
    version: get("Doc version"),
  };
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = path.resolve(process.cwd(), "Vector_Scope.md");
  const raw = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (raw === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const meta = parseMeta(raw);

  // Split on level-2 headers — supports "## 1. Title" and "## A1. Title"
  const sectionRegex = /^## ([A-Z]?\d+)\.\s+(.+)$/m;
  const parts = raw.split(/(?=^## [A-Z]?\d+\. )/m);

  const sections: ScopeSection[] = [];
  for (const part of parts) {
    const match = part.match(sectionRegex);
    if (!match) continue;
    const number = match[1];
    const title = match[2].trim();
    const id = `${number}-${slugify(title)}`;
    const html = await marked.parse(part);
    sections.push({ id, number, title, html });
  }

  return NextResponse.json({ meta, sections } satisfies ScopeDoc);
}
