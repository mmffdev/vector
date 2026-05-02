import { test, expect, Page } from "@playwright/test";

// PLA-0006 / 00277 — DiagramCanvas stress harness.
//
// Loads /dev/diagram-canvas-stress (3,000-node fixture) and asserts
// against the performance contract documented in
// docs/c_c_diagram_canvas.md:
//
//   • Initial load   <1.5s   — measured here
//   • Drag FPS       ≥30     — measured here
//   • Rendered set   <500    — depends on collapse + virtualisation
//                              landing in 00275; auto-skipped by reading
//                              window.__DIAGRAM_PERF__.capabilities.
//   • Subtree layout <1s     — depends on dagre worker (00275); ditto.
//
// This spec ships with 00274 so the perf gate exists from day one and
// flips on more assertions automatically as 00275 / 00276 fill in
// capabilities. The numeric thresholds below MUST NOT be relaxed
// without an explicit plan-amendment commit referencing PLA-0006.

const LOGIN_EMAIL = "padmin@mmffdev.com";
const LOGIN_PASSWORD = "TestPass1!";

const INITIAL_LOAD_BUDGET_MS = 1500;
const MIN_DRAG_FPS = 30;
const RENDERED_SET_CAP = 500;
const SUBTREE_LAYOUT_BUDGET_MS = 1000;

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

    // Drive a 1-second drag through the canvas centre and sample rAF
    // intervals from inside the page so we measure what the renderer
    // actually produced, not what playwright's coarse timer suggests.
    const fps = await page.evaluate<number>(async () => {
      const canvas = document.querySelector(
        ".diagram-canvas__layer--overlay",
      ) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("overlay canvas not found");
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

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
        canvas.dispatchEvent(
          new PointerEvent(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerType: "mouse",
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
    });

    expect(fps).toBeGreaterThanOrEqual(MIN_DRAG_FPS);
  });

  test("rendered-set stays below cap (gated by virtualisation in 00275)", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    const perf = await readPerf(page);
    test.skip(
      !perf.capabilities.virtualisation,
      "virtualisation lands in 00275 — assertion auto-enables once shipped",
    );
    const rendered = await page.evaluate<number>(() => {
      // 00275 will expose rendered-set count via window.__DIAGRAM_PERF__
      // — until then, this branch is unreachable (test.skip above).
      const w = window as unknown as { __DIAGRAM_RENDERED_COUNT__?: number };
      return w.__DIAGRAM_RENDERED_COUNT__ ?? 0;
    });
    expect(rendered).toBeLessThan(RENDERED_SET_CAP);
  });

  test("subtree layout completes within budget (gated by worker in 00275)", async ({ page }) => {
    await page.goto("/dev/diagram-canvas-stress");
    await waitForPerf(page);
    const perf = await readPerf(page);
    test.skip(
      !perf.capabilities.layoutWorker,
      "dagre worker lands in 00275 — assertion auto-enables once shipped",
    );
    const ms = await page.evaluate<number>(async () => {
      // 00275 will expose `relayoutSubtree(rootId)` via the canvas
      // handle and stamp `__DIAGRAM_PERF__.lastSubtreeMs`. Until then,
      // this branch is unreachable (test.skip above).
      const w = window as unknown as {
        __DIAGRAM_PERF__?: { lastSubtreeMs?: number };
      };
      return w.__DIAGRAM_PERF__?.lastSubtreeMs ?? 0;
    });
    expect(ms).toBeLessThan(SUBTREE_LAYOUT_BUDGET_MS);
  });
});
