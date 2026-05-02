import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

export type PlanWorkItem = {
  order: number;
  title: string;
  story_id: string | null;
  card_url: string | null;
  status: "todo" | "doing" | "completed" | "blocked" | string;
  notes?: string;
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
const PLANKA_BIN = path.join(process.cwd(), ".claude", "bin", "planka");

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(dt: string | null | undefined): string | null {
  if (!dt) return null;
  return dt.slice(0, 10);
}

function listNameToStatus(name: string): PlanWorkItem["status"] | null {
  const n = name.trim().toLowerCase();
  if (n === "backlog") return "todo";
  if (n === "to do" || n === "todo") return "todo";
  if (n === "doing" || n === "in progress") return "doing";
  if (n === "completed" || n === "done") return "completed";
  if (n === "blocked") return "blocked";
  return null;
}

type BoardCard = { id: string; name: string; listId: string; createdAt?: string; updatedAt?: string };
type BoardJSON = {
  item?: { id?: string };
  included?: {
    lists?: Array<{ id: string; name: string }>;
    labels?: Array<{ id: string; name: string }>;
    cardLabels?: Array<{ cardId: string; labelId: string }>;
    cards?: BoardCard[];
  };
};

async function fetchBoard(): Promise<BoardJSON | null> {
  try {
    const { stdout } = await execFileP(PLANKA_BIN, ["board"], { maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout) as BoardJSON;
  } catch {
    return null;
  }
}

function syncPlanFromBoard(plan: PlanDoc, board: BoardJSON): { plan: PlanDoc; changed: boolean } {
  const inc = board.included ?? {};
  const lists = (inc.lists ?? []) as Array<{ id: string; name: string }>;
  const labels = (inc.labels ?? []) as Array<{ id: string; name: string }>;
  const cardLabels = (inc.cardLabels ?? []) as Array<{ cardId: string; labelId: string }>;
  const cards = (inc.cards ?? []) as BoardCard[];

  const listNameById = new Map(lists.map(l => [l.id, l.name]));
  const planLabel = labels.find(l => l.name === plan.id);
  if (!planLabel) {
    return { plan, changed: false };
  }

  const cardIdsForPlan = new Set(
    cardLabels.filter(cl => cl.labelId === planLabel.id).map(cl => cl.cardId)
  );

  const cardsForPlan = cards.filter(c => cardIdsForPlan.has(c.id));
  const cardById = new Map(cardsForPlan.map(c => [c.id, c]));

  const before = JSON.stringify(plan);

  const next: PlanDoc = {
    ...plan,
    work_item_backlog: plan.work_item_backlog.map(wi => {
      const matchCard = wi.card_url
        ? cardsForPlan.find(c => wi.card_url!.endsWith(`/cards/${c.id}`))
        : (wi.story_id
            ? cardsForPlan.find(c => c.name.startsWith(`${wi.story_id} `) || c.name.startsWith(`${wi.story_id}—`) || c.name.startsWith(`${wi.story_id}  —`))
            : undefined);
      if (!matchCard) return wi;
      const listName = listNameById.get(matchCard.listId) ?? "";
      const status = listNameToStatus(listName);
      return {
        ...wi,
        card_url: wi.card_url ?? `http://localhost:3333/cards/${matchCard.id}`,
        status: status ?? wi.status,
      };
    }),
  };

  let earliestDoing: string | null = null;
  let latestUpdate: string | null = null;
  let latestCompleted: string | null = null;
  let everyCompleted = next.work_item_backlog.length > 0;

  for (const wi of next.work_item_backlog) {
    const card = wi.card_url
      ? cardsForPlan.find(c => wi.card_url!.endsWith(`/cards/${c.id}`))
      : undefined;
    if (!card) { everyCompleted = false; continue; }
    const updated = isoDate(card.updatedAt) ?? isoDate(card.createdAt);
    if (updated && (!latestUpdate || updated > latestUpdate)) latestUpdate = updated;
    if (wi.status === "doing" || wi.status === "completed") {
      const created = isoDate(card.createdAt) ?? updated;
      if (created && (!earliestDoing || created < earliestDoing)) earliestDoing = created;
    }
    if (wi.status === "completed") {
      if (updated && (!latestCompleted || updated > latestCompleted)) latestCompleted = updated;
    } else {
      everyCompleted = false;
    }
  }

  if (earliestDoing && !next.date_started) next.date_started = earliestDoing;
  next.date_last_updated = latestUpdate ?? todayISO();
  next.date_finished = everyCompleted ? (latestCompleted ?? todayISO()) : null;

  for (const wi of next.work_item_backlog) {
    const matchCard = cardById.size && wi.card_url
      ? cardsForPlan.find(c => wi.card_url!.endsWith(`/cards/${c.id}`))
      : undefined;
    if (matchCard && (wi.status === "completed" || wi.status === "doing")) {
      next.acceptance_criteria = next.acceptance_criteria.map(ac =>
        ac.story_id && ac.story_id === wi.story_id && wi.status === "completed"
          ? { ...ac, done: true }
          : ac
      );
    }
  }

  const after = JSON.stringify(next);
  return { plan: next, changed: before !== after };
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

function writePlan(plan: PlanDoc): void {
  fs.writeFileSync(planPath(plan.id), JSON.stringify(plan, null, 2) + "\n", "utf-8");
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const sync = searchParams.get("sync");

  if (!fs.existsSync(PLANS_DIR)) {
    if (id || sync) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ plans: [] });
  }

  const targetId = sync ?? id;

  if (targetId) {
    if (!/^PLA-\d{4,}$/.test(targetId)) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const plan = readPlan(targetId);
    if (!plan) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (sync) {
      const board = await fetchBoard();
      if (board) {
        const { plan: synced, changed } = syncPlanFromBoard(plan, board);
        if (changed) writePlan(synced);
        return NextResponse.json(synced);
      }
      return NextResponse.json(plan);
    }

    return NextResponse.json(plan);
  }

  try {
    const files = fs.readdirSync(PLANS_DIR)
      .filter(f => /^PLA-\d{4,}\.json$/.test(f))
      .sort();

    const plans: PlanMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(PLANS_DIR, file), "utf-8");
        plans.push(summarise(JSON.parse(raw) as PlanDoc));
      } catch {
        // skip malformed
      }
    }
    return NextResponse.json({ plans });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}
