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
const LOGIN_PASSWORD = "password";

const INITIAL_LOAD_BUDGET_MS = 1500;
const MIN_DRAG_FPS = 30;
const RENDERED_SET_CAP = 500;
const SUBTREE_LAYOUT_BUDGET_MS = 1000;
const TARGET_DRAG_NODE_ID = "n1530";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).fill(LOGIN_PASSWORD);
  // Submit via Enter — `next dev --turbo` mounts a <nextjs-portal>
  // overlay that intercepts pointer events on the submit button.
  await page.getByLabel(/password/i).press("Enter");
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 3000 });
  } catch {
    await page.getByRole("button", { name: /sign in/i }).click({ force: true });
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

async function waitForPerf(page: Page) {
  await page.waitForFunction(() => Boolean(window.__DIAGRAM_PERF__?.ready), null, {
    timeout: 5000,
  });
  await page.waitForFunction(() => Boolean(window.__DIAGRAM_HARNESS__), null, {
    timeout: 5000,
  });
}

// First-paint fitView produces a tiny scale (≈0.156 for the 3,000-node
// fixture) where every node falls inside the viewport — virtualisation
// has nothing to cull, and the rendered-set cap will fail. Zoom in on
// the drag target so most nodes drop off-screen, then wait for the
// viewport to settle before reading any visibility-dependent telemetry.
async function zoomInOnTarget(page: Page, nodeId: string, scale = 1) {
  await page.evaluate(
    ({ id, s }: { id: string; s: number }) => {
      const h = window.__DIAGRAM_HARNESS__;
      if (!h) return;
      // Zoom first — zoomTo holds the canvas-centre world point fixed.
      // Then centerOn re-anchors the target node at current scale.
      h.zoomTo(s);
      h.centerOn(id);
    },
    { id: nodeId, s: scale },
  );
  // The renderer paints on rAF; wait for a viewport scale stamp that
  // matches what we asked for and a non-stale rendered-count.
  await page.waitForFunction(
    (target: number) => {
      const vp = window.__DIAGRAM_HARNESS__?.getViewport();
      if (!vp) return false;
      return Math.abs(vp.scale - target) < 0.01;
    },
    scale,
    { timeout: 2000 },
  );
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

    // At fitView scale (~0.156) the whole grid is on screen and a
    // pointer drag on `n1530` lands on a 16×6 px footprint — barely
    // grippable. Zoom in to scale 1 first so the node has its full
    // 100×40 footprint and nearby nodes give the renderer real work.
    await zoomInOnTarget(page, TARGET_DRAG_NODE_ID, 1);

    // Resolve the target node's screen position via the harness so the
    // drag actually grips a node — measuring rendering throughput, not
    // an empty-canvas idle loop.
    const center = await page.evaluate((id: string) => {
      return window.__DIAGRAM_HARNESS__?.getNodeScreenCenter(id) ?? null;
    }, TARGET_DRAG_NODE_ID);
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      throw new Error(`could not resolve center of ${TARGET_DRAG_NODE_ID}`);
    }

    // Drive a 1-second drag through the resolved node centre and sample
    // rAF intervals from inside the page so we measure what the
    // renderer actually produced, not what playwright's coarse timer
    // suggests. (`center` is `{x,y}` — rebind to `cx/cy` for the
    // pointer-event payload.)
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
    }, { cx: center.x, cy: center.y });

    expect(fps).toBeGreaterThanOrEqual(MIN_DRAG_FPS);
  });

  test("rendered-set stays below cap", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    // The rendered-set cap is a virtualisation guarantee: when most of
    // the graph is off-screen, paintStatic must skip those nodes. At
    // first-paint we deliberately fitView the entire fixture so the
    // user sees their org; zoom in to exercise the cull path.
    //
    // Clear the stale fitView count so the wait below blocks on a
    // post-zoom paint instead of returning the pre-zoom value.
    await page.evaluate(() => {
      window.__DIAGRAM_RENDERED_COUNT__ = undefined;
    });
    await zoomInOnTarget(page, TARGET_DRAG_NODE_ID, 1);
    // Wait for the next paint pass to stamp a fresh count below the cap.
    await page.waitForFunction(
      (cap: number) => {
        const n = window.__DIAGRAM_RENDERED_COUNT__;
        return typeof n === "number" && n > 0 && n < cap;
      },
      RENDERED_SET_CAP,
      { timeout: 5000 },
    );
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
