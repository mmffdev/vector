import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type Why = { depth: number; statement: string };
type ReversalLink = { from: number; to: number; verb: string; chain: string };

export type RetroFinding = {
  order: number;
  ref: string;
  category: string;
  issue: string;
  whys: Why[];
  reversal: ReversalLink[];
  chain_broken_at: number | null;
  resolution_steps: string[];
  severity: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  fingerprint: string;
  ledger_entry_id: string | null;
  planka_card_id: string | null;
  tech_debt_ref: string | null;
};

export type RetroWin = {
  order: number;
  ref: string;
  category: string;
  win: string;
  why_it_worked: string;
  score: 1 | 2 | 3 | 4 | 5;
};

export type RetroDoc = {
  id: string;
  title: string;
  date: string;
  triggered_by: "user" | "loop-detector";
  scope: "segment" | "full";
  session_jsonl: string;
  linked_plan: string | null;
  linked_cards: string[];
  signals: {
    wallclock_minutes: number;
    tool_call_count: number;
    error_count: number;
    files_read: number;
    files_re_read: number;
    files_written: number;
    tool_repeats_max: number;
    loop_signals: Record<string, unknown> | null;
  };
  honest_assessment: string;
  table_1_root_causes: RetroFinding[];
  table_2_what_went_well: RetroWin[];
  loop_signals: Record<string, unknown> | null;
  claudemd_proposals_path: string | null;
};

export type RetroMeta = Omit<RetroDoc, "honest_assessment" | "table_1_root_causes" | "table_2_what_went_well"> & {
  honest_assessment_text: string;
  finding_count: number;
  win_count: number;
  max_severity: number;
};

export type LedgerHit = {
  retro_id: string;
  severity: number;
  prompt_excerpt: string;
  chain_of_events: string;
  hit_at: string;
};

export type LedgerEntry = {
  id: string;
  fingerprint: string;
  area_of_concern: string;
  hit_count: number;
  first_seen: string;
  last_seen: string;
  severity_trend: string;
  status: "open" | "in-progress" | "resolved";
  resolved_by: string | null;
  hits: LedgerHit[];
};

export type Ledger = { version: number; entries: LedgerEntry[] };

const RETROS_DIR = path.join(process.cwd(), "dev", "retros");
const LEDGER_PATH = path.join(RETROS_DIR, "LEDGER.json");

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const view = searchParams.get("view"); // "ledger" | null

  if (!fs.existsSync(RETROS_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (view === "ledger") return NextResponse.json({ version: 1, entries: [] });
    return NextResponse.json({ retros: [] });
  }

  if (view === "ledger") {
    if (!fs.existsSync(LEDGER_PATH)) {
      return NextResponse.json({ version: 1, entries: [] });
    }
    try {
      return NextResponse.json(JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8")) as Ledger);
    } catch {
      return NextResponse.json({ error: "malformed ledger" }, { status: 500 });
    }
  }

  if (id) {
    if (!/^RETRO-\d+$/.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const filePath = path.join(RETROS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw) as RetroDoc);
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 500 });
    }
  }

  try {
    const files = fs.readdirSync(RETROS_DIR)
      .filter(f => /^RETRO-\d+\.json$/.test(f))
      .sort()
      .reverse();

    const retros: RetroMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(RETROS_DIR, file), "utf-8");
        const doc = JSON.parse(raw) as RetroDoc;
        const honest_assessment_text = typeof doc.honest_assessment === "string"
          ? doc.honest_assessment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const findings = Array.isArray(doc.table_1_root_causes) ? doc.table_1_root_causes : [];
        const wins = Array.isArray(doc.table_2_what_went_well) ? doc.table_2_what_went_well : [];
        const max_severity = findings.reduce((m, f) => Math.max(m, f.severity ?? 0), 0);

        const { honest_assessment: _h, table_1_root_causes: _t1, table_2_what_went_well: _t2, ...meta } = doc;
        retros.push({
          ...meta,
          honest_assessment_text,
          finding_count: findings.length,
          win_count: wins.length,
          max_severity,
        } as RetroMeta);
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ retros });
  } catch {
    return NextResponse.json({ retros: [] });
  }
}
