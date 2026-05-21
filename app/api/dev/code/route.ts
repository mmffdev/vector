import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type CodeMeta = {
  id: string;
  title: string;
  category: string;
  topic: string;
  date: string;
  summary: string;
  content_text: string;
};

export type CodeReport = CodeMeta & {
  content: string;
};

const CODE_DIR = path.join(process.cwd(), "dev", "code");

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!fs.existsSync(CODE_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ reports: [] });
  }

  if (id) {
    if (!/^CO\d+$/.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const filePath = path.join(CODE_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as CodeReport);
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 500 });
    }
  }

  try {
    const files = fs.readdirSync(CODE_DIR)
      .filter(f => /^CO\d+\.json$/.test(f))
      .sort()
      .reverse();

    const reports: CodeMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(CODE_DIR, file), "utf-8");
        const { content, ...meta } = JSON.parse(raw);
        const content_text = typeof content === "string"
          ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        reports.push({ ...meta, content_text } as CodeMeta);
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
