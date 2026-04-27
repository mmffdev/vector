import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type ReportCheck = {
  status: "pass" | "warn" | "fail" | "fixed";
  label: string;
  detail: string;
};

export type MemoryReport = {
  id: string;
  scope: "A" | "M" | "S" | "C" | "H";
  scopeName: string;
  flag: string;
  timestamp: string;
  checks: ReportCheck[];
  summary: { pass: number; warn: number; fail: number; fixed?: number };
};

const REPORTS_DIR = path.join(process.cwd(), "dev", "reports");

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!fs.existsSync(REPORTS_DIR)) {
    return NextResponse.json({ reports: [] });
  }

  try {
    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse();

    const reports: MemoryReport[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(REPORTS_DIR, file), "utf-8");
        reports.push(JSON.parse(raw) as MemoryReport);
      } catch {
        // skip malformed files
      }
    }
    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
