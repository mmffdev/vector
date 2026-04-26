import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const ALLOWED_DIRS = [
  { dir: "docs", label: "docs/" },
  { dir: "dev/planning", label: "dev/planning/" },
];

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const root = process.cwd();
  const files: { name: string; dir: string; path: string; size: number; mtime: number }[] = [];

  for (const { dir, label } of ALLOWED_DIRS) {
    const abs = path.join(root, dir);
    const entries = await fs.readdir(abs).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const stat = await fs.stat(path.join(abs, entry)).catch(() => null);
      if (!stat) continue;
      files.push({
        name: entry,
        dir: label,
        path: `${dir}/${entry}`,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }

  files.sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
  return NextResponse.json(files);
}
