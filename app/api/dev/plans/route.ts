import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export type PlanWorkItem = {
  order: number;
  title: string;
  story_id: string | null;
  card_url: string | null;
  status: "todo" | "doing" | "completed" | "blocked" | string;
  notes?: string;
  description?: string;
  tags?: string[];
  /** Red-Green Feature-Driven SOP fields — see .claude/skills/stories/SKILL.md §5 */
  kind?: "implementation" | "feature_test";
  feature_id?: string;
  feature_name?: string;
  covers?: string[];
  tracker_group?: string;
};

export type PlanAcceptance = {
  order: number;
  criterion: string;
  proven_by: string;
  story_id: string | null;
  card_url: string | null;
  done: boolean;
};

export type PlanRisk = {
  impact: number;
  risk: string;
  mitigation: string;
};

export type PlanReference = {
  kind: "internal" | "external";
  label: string;
  href: string;
};

export type PlanDoc = {
  id: string;
  title: string;
  date_created: string;
  date_started: string | null;
  date_last_updated: string | null;
  date_finished: string | null;
  scope: string;
  value: string;
  implementation_plan: string[];
  areas_impacted: string[];
  feature_list: string[];
  features_extended: string[];
  features_removed: string[];
  work_item_backlog: PlanWorkItem[];
  acceptance_criteria: PlanAcceptance[];
  risks: PlanRisk[];
  references: PlanReference[];
  /** Red-Green Feature-Driven SOP — kebab `<scope>-<plan-slug>`, e.g. `backend-workspace-foundation`. */
  tracker_group?: string;
};

export type PlanMeta = Pick<
  PlanDoc,
  "id" | "title" | "date_created" | "date_started" | "date_last_updated" | "date_finished"
> & {
  acceptance_total: number;
  acceptance_done: number;
  work_item_total: number;
  work_item_completed: number;
};

const PLANS_DIR = path.join(process.cwd(), "dev", "plans");

function summarise(plan: PlanDoc): PlanMeta {
  const acTotal = plan.acceptance_criteria?.length ?? 0;
  const acDone  = plan.acceptance_criteria?.filter(a => a.done).length ?? 0;
  const wiTotal = plan.work_item_backlog?.length ?? 0;
  const wiDone  = plan.work_item_backlog?.filter(w => w.status === "completed").length ?? 0;
  return {
    id: plan.id,
    title: plan.title,
    date_created: plan.date_created,
    date_started: plan.date_started,
    date_last_updated: plan.date_last_updated,
    date_finished: plan.date_finished,
    acceptance_total: acTotal,
    acceptance_done: acDone,
    work_item_total: wiTotal,
    work_item_completed: wiDone,
  };
}

function planPath(id: string): string {
  return path.join(PLANS_DIR, `${id}.json`);
}

function readPlan(id: string): PlanDoc | null {
  try {
    const raw = fs.readFileSync(planPath(id), "utf-8");
    return JSON.parse(raw) as PlanDoc;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!fs.existsSync(PLANS_DIR)) {
    if (id) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ plans: [] });
  }

  if (id) {
    if (!/^PLA-\d{4,}$/.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const plan = readPlan(id);
    if (!plan) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(plan);
  }

  try {
    const files = fs.readdirSync(PLANS_DIR)
      .filter(f => /^PLA-\d{4,}\.json$/.test(f))
      .sort()
      .reverse();

    const plans: PlanMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(PLANS_DIR, file), "utf-8");
        const plan = JSON.parse(raw) as PlanDoc;
        plans.push(summarise(plan));
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ plans });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}
