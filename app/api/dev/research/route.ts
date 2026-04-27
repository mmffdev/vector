import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type ResearchMeta = {
  id: string;
  title: string;
  category: string;
  topic: string;
  date: string;
  summary: string;
};

export type ResearchReport = ResearchMeta & {
  content: string;
};

const RESEARCH_DIR = path.join(process.cwd(), "dev", "research");

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!fs.existsSync(RESEARCH_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ reports: [] });
  }

  if (id) {
    const filePath = path.join(RESEARCH_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as ResearchReport);
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 500 });
    }
  }

  try {
    const files = fs.readdirSync(RESEARCH_DIR)
      .filter(f => /^R\d+\.json$/.test(f))
      .sort()
      .reverse();

    const reports: ResearchMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(RESEARCH_DIR, file), "utf-8");
        const { content: _content, ...meta } = JSON.parse(raw);
        reports.push(meta as ResearchMeta);
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
