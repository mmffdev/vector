import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SNAP_DIR = path.join(process.cwd(), "api-snapshots");

function readFile(name: string): string {
  const p = path.join(SNAP_DIR, name);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

function latestSnapshot(): { version: string; date: string } {
  let latestN = 0;
  if (fs.existsSync(SNAP_DIR)) {
    for (const f of fs.readdirSync(SNAP_DIR)) {
      const m = f.match(/^v(\d+)\.yaml$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > latestN) latestN = n;
      }
    }
  }
  if (latestN === 0) return { version: "none", date: "" };

  const changelog = readFile("CHANGELOG.md");
  const dateMatch = changelog.match(/## v\d+ — (\d{4}-\d{2}-\d{2})/g);
  const lastDate = dateMatch ? dateMatch[dateMatch.length - 1].replace(/## v\d+ — /, "") : "";
  return { version: `v${latestN}`, date: lastDate };
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const changelog = readFile("blast-radius-latest.md");
  const callerMapRaw = readFile("caller-map.json");
  const deadApisRaw = readFile("dead-apis.txt");
  const { version, date } = latestSnapshot();

  let callerMap: Record<string, string[]> = {};
  try {
    callerMap = callerMapRaw ? JSON.parse(callerMapRaw) : {};
  } catch {
    callerMap = {};
  }

  const deadApis = deadApisRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return NextResponse.json({
    changelog,
    caller_map: callerMap,
    dead_apis: deadApis,
    snapshot_version: version,
    snapshot_date: date,
  });
}
