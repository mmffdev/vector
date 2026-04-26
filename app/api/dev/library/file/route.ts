import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { marked } from "marked";

const ALLOWED_ROOTS = ["docs", "dev/planning"];

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = req.nextUrl.searchParams.get("path") ?? "";
  const root = process.cwd();
  const resolved = path.resolve(root, filePath);

  const allowed = ALLOWED_ROOTS.some((r) =>
    resolved.startsWith(path.resolve(root, r) + path.sep)
  );
  if (!allowed || !resolved.endsWith(".md")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await fs.readFile(resolved, "utf-8").catch(() => null);
  if (raw === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const html = await marked.parse(raw);
  return NextResponse.json({ html });
}
