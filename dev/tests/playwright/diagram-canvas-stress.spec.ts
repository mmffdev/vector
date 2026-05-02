import { test, expect, Page } from "@playwright/test";

// PLA-0006 / 00277 — DiagramCanvas stress harness.
//
// Loads /dev/diagram-canvas-stress (3,000-node fixture) and asserts
// against the performance contract documented in
// docs/c_c_diagram_canvas.md:
//
//   • Initial load   <1.5s
//   • Drag FPS       ≥30
//   • Rendered set   <500   (00275 — virtualisation in paintStatic)
//   • Subtree layout <1s    (00275 — dagre Web Worker)
//
// The numeric thresholds below MUST NOT be relaxed without an explicit
// plan-amendment commit referencing PLA-0006.

const LOGIN_EMAIL = "padmin@mmffdev.com";
const LOGIN_PASSWORD = "TestPass1!";

const INITIAL_LOAD_BUDGET_MS = 1500;
const MIN_DRAG_FPS = 30;
const RENDERED_SET_CAP = 500;
const SUBTREE_LAYOUT_BUDGET_MS = 1000;
const TARGET_DRAG_NODE_ID = "n1530";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function waitForPerf(page: Page) {
  await page.waitForFunction(() => Boolean(window.__DIAGRAM_PERF__?.ready), null, {
    timeout: 5000,
  });
  await page.waitForFunction(() => Boolean(window.__DIAGRAM_HARNESS__), null, {
    timeout: 5000,
  });
}

async function readPerf(page: Page) {
  return page.evaluate(() => {
    const p = window.__DIAGRAM_PERF__;
    if (!p) throw new Error("no perf object");
    return {
      firstPaintMs: p.firstPaintMs,
      capabilities: p.capabilities,
      dragSamples: p.dragSamples.slice(),
    };
  });
}

test.describe("diagram-canvas stress (3,000 nodes)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("initial paint completes within budget", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    const perf = await readPerf(page);
    expect(perf.firstPaintMs).not.toBeNull();
    expect(perf.firstPaintMs!).toBeLessThan(INITIAL_LOAD_BUDGET_MS);
  });

  test("drag sustains target FPS", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);

    // Resolve the target node's screen position via the harness so the
    // drag actually grips a node — measuring rendering throughput, not
    // an empty-canvas idle loop.
    const center = await page.evaluate((id: string) => {
      return window.__DIAGRAM_HARNESS__?.getNodeScreenCenter(id) ?? null;
    }, TARGET_DRAG_NODE_ID);
    if (!center) throw new Error(`could not resolve center of ${TARGET_DRAG_NODE_ID}`);

    // Drive a 1-second drag through the resolved node centre and sample
    // rAF intervals from inside the page so we measure what the
    // renderer actually produced, not what playwright's coarse timer
    // suggests.
    const fps = await page.evaluate<number, { cx: number; cy: number }>(async ({ cx, cy }) => {
      const root = document.querySelector(".diagram-canvas") as HTMLElement | null;
      if (!root) throw new Error("diagram-canvas root not found");

      const samples: number[] = [];
      let last = performance.now();
      let stop = false;
      const tick = (t: number) => {
        samples.push(t - last);
        last = t;
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const dispatch = (type: string, x: number, y: number) =>
        root.dispatchEvent(
          new PointerEvent(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerType: "mouse",
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );

      dispatch("pointerdown", cx, cy);
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        const t = (performance.now() - t0) / 1000;
        const dx = Math.sin(t * Math.PI * 2) * 80;
        const dy = Math.cos(t * Math.PI * 2) * 80;
        dispatch("pointermove", cx + dx, cy + dy);
        await new Promise((r) => setTimeout(r, 16));
      }
      dispatch("pointerup", cx, cy);
      stop = true;

      const valid = samples.filter((s) => s > 0 && s < 200);
      if (valid.length === 0) return 0;
      const meanFrameMs = valid.reduce((a, b) => a + b, 0) / valid.length;
      return 1000 / meanFrameMs;
    }, center);

    expect(fps).toBeGreaterThanOrEqual(MIN_DRAG_FPS);
  });

  test("rendered-set stays below cap", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    // Wait for at least one paint pass to have stamped a count.
    await page.waitForFunction(() => typeof window.__DIAGRAM_RENDERED_COUNT__ === "number", null, {
      timeout: 5000,
    });
    const rendered = await page.evaluate<number>(() => {
      return window.__DIAGRAM_RENDERED_COUNT__ ?? 0;
    });
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(RENDERED_SET_CAP);
  });

  test("subtree layout completes within budget", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    const ms = await page.evaluate<number>(async () => {
      const harness = window.__DIAGRAM_HARNESS__;
      if (!harness) throw new Error("harness missing");
      // Lay out the subtree rooted at n0 — the whole graph for our
      // single-tree fixture, which exercises the worst-case worker
      // payload.
      return harness.relayoutSubtree("n0");
    });
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(SUBTREE_LAYOUT_BUDGET_MS);
  });
});
