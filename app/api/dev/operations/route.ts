import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type OperationMeta = {
  id: string;
  title: string;
  category: string;
  topic: string;
  date: string;
  summary: string;
  content_text: string;
};

export type OperationReport = OperationMeta & {
  content: string;
};

const OPERATIONS_DIR = path.join(process.cwd(), "dev", "operations");

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!fs.existsSync(OPERATIONS_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ reports: [] });
  }

  if (id) {
    if (!/^O\d+$/.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const filePath = path.join(OPERATIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as OperationReport);
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 500 });
    }
  }

  try {
    const files = fs.readdirSync(OPERATIONS_DIR)
      .filter(f => /^O\d+\.json$/.test(f))
      .sort()
      .reverse();

    const reports: OperationMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(OPERATIONS_DIR, file), "utf-8");
        const { content, ...meta } = JSON.parse(raw);
        const content_text = typeof content === "string"
          ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        reports.push({ ...meta, content_text } as OperationMeta);
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
