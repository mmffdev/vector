import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type SecurityAuditMeta = {
  id: string;
  title: string;
  category: string;
  date: string;
  summary: string;
  content_text: string;
};

export type SecurityAuditReport = SecurityAuditMeta & {
  content: string;
};

const AUDITS_DIR = path.join(process.cwd(), "dev", "security-audits");

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!fs.existsSync(AUDITS_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ audits: [] });
  }

  if (id) {
    if (!/^SA\d+$/.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const filePath = path.join(AUDITS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as SecurityAuditReport);
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 500 });
    }
  }

  try {
    const files = fs.readdirSync(AUDITS_DIR)
      .filter(f => /^SA\d+\.json$/.test(f))
      .sort()
      .reverse();

    const audits: SecurityAuditMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(AUDITS_DIR, file), "utf-8");
        const { content, ...meta } = JSON.parse(raw);
        const content_text = typeof content === "string"
          ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        audits.push({ ...meta, content_text } as SecurityAuditMeta);
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ audits });
  } catch {
    return NextResponse.json({ audits: [] });
  }
}
