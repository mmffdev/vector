"use client";

import { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// BarGrid3D chart — interactive 3D scalar grid (rows × cols matrix).
// Each bar's X = column index, Z = row index, Y (height) = cell value.
// Drag horizontally to rotate the scene around the vertical axis.
//
// SPECIAL CASE — this chart deliberately breaks several /chart skill
// rules because of its 3D / interactive nature:
//   • Renders via WebGL (vanilla three.js) instead of SVG.
//   • Drives the canvas imperatively from useEffect — no React
//     reconciler in the render path. We tried @react-three/fiber@8 and
//     hit a known incompatibility with React 18.3.1 + Next 15 webpack
//     (fiber's bundled react-reconciler reads ReactCurrentOwner from
//     React internals and the path isn't reachable through Next's
//     bundling). Plain three sidesteps the problem entirely.
//   • `colorMode="rainbow"` is an explicit opt-in to a heatmap gradient
//     that bypasses the "no decorative colour" rule on purpose, for
//     heatmap-style data where colour conveys magnitude.
//   • Theme tokens are read via getComputedStyle at scene build; theme
//     swaps require remount of the chart to pick up new colours (SVG
//     charts get this for free via the cascade — WebGL does not).
//
// Usage: <BarGrid3DChart />                                    // mono, stub data
//        <BarGrid3DChart data={[[...], ...]} colorMode="rainbow" />
//        <BarGrid3DChart randomize />                          // PREVIEW ONLY

export type ColorMode = "mono" | "rainbow";

const DEFAULT_X_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DEFAULT_Y_LABELS = ["Direct", "Social Media", "Search", "Others"];

// Replace `DEFAULT_DATA` with API data when wiring up.
// rows = Y axis (categories), cols = X axis (time buckets); cell = Z height.
const DEFAULT_DATA: number[][] = [
  [80, 60, 40, 20, 100],
  [120, 100, 70, 50, 140],
  [140, 110, 90, 60, 160],
  [180, 130, 100, 50, 110],
];

const SCENE_HEIGHT_UNITS = 3.2;
const BAR_FOOTPRINT = 0.7;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every cell, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape (3D bar grid / scalar 2D matrix):
//   • Per-cell scalar in [floor, max] — no sum constraint.
//   • Allow zero-cells (gaps in the grid) PROVIDED ≥30% of cells are
//     non-zero so the 3D scene still reads as a populated landscape.
//   • Coerce NaN / Infinity to floor.
//   • Round to int for clean display.
//   • Row & col counts match the configured arrays.
// If you add a 3D chart with different constraints, write a separate
// generator — do not reuse this one.
// =============================================================
function randomGrid(rows: number, cols: number, max: number): number[][] {
  const FLOOR = 10;
  const total = rows * cols;
  while (true) {
    const grid: number[][] = [];
    let nonZero = 0;
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        const dropout = Math.random() < 0.18;
        const raw = dropout ? 0 : FLOOR + Math.random() * (max - FLOOR);
        const safe = Number.isFinite(raw) ? Math.round(raw) : FLOOR;
        grid[r][c] = safe;
        if (safe > 0) nonZero++;
      }
    }
    if (nonZero / total >= 0.3) return grid;
  }
}

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readMonoTones(): string[] {
  const fallback = ["#cccccc", "#aaaaaa", "#888888", "#555555"];
  return [
    readToken("--surface", fallback[0]),
    readToken("--surface-sunken", fallback[1]),
    readToken("--border", fallback[2]),
    readToken("--border-strong", fallback[3]),
  ];
}

function rainbowFor(value: number, max: number): string {
  const t = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  // hue 0 (red) at low → 240 (blue) at high, passing through green
  const hue = t * 240;
  return `hsl(${hue}, 72%, 56%)`;
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = "600 64px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  // Always-on-top overlay: depthTest off so the label ignores any bar in
  // front of it, depthWrite off so it doesn't block other transparents,
  // and a high renderOrder so it's the last thing painted in the frame.
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.4, 0.35, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function buildScene(
  container: HTMLDivElement,
  data: number[][],
  colorMode: ColorMode,
  xLabels: string[],
  yLabels: string[],
): () => void {
  const tones = readMonoTones();
  const gridColor = readToken("--ink-faint", "#999999");
  const inkColor = readToken("--ink-muted", "#222222");

  const rows = data.length;
  const cols = data[0]?.length ?? 0;
  const xOffset = (cols - 1) / 2;
  const zOffset = (rows - 1) / 2;
  const span = Math.max(rows, cols) + 2;
  const max = Math.max(...data.flat(), 1);

  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(5.5, 5, 5.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(6, 10, 6);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  scene.add(dirLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
  rimLight.position.set(-4, 6, -4);
  scene.add(rimLight);

  const grid = new THREE.GridHelper(span, span, gridColor, gridColor);
  scene.add(grid);

  const disposables: { dispose(): void }[] = [grid.geometry, grid.material as THREE.Material];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = data[r][c];
      if (v <= 0) continue;
      const x = c - xOffset;
      const z = r - zOffset;
      const h = (v / max) * SCENE_HEIGHT_UNITS;
      const safeH = Math.max(0.05, h);
      const colorStr =
        colorMode === "rainbow" ? rainbowFor(v, max) : tones[r % tones.length];
      const geom = new THREE.BoxGeometry(BAR_FOOTPRINT, safeH, BAR_FOOTPRINT);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorStr),
        roughness: 0.55,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, safeH / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      disposables.push(geom, mat);
    }
  }

  for (let i = 0; i < Math.min(cols, xLabels.length); i++) {
    const sprite = makeLabelSprite(xLabels[i], inkColor);
    sprite.position.set(i - xOffset, 0.18, zOffset + 1.1);
    scene.add(sprite);
    const sm = sprite.material as THREE.SpriteMaterial;
    if (sm.map) disposables.push(sm.map);
    disposables.push(sm);
  }
  for (let i = 0; i < Math.min(rows, yLabels.length); i++) {
    const sprite = makeLabelSprite(yLabels[i], inkColor);
    sprite.position.set(xOffset + 1.4, 0.18, i - zOffset);
    scene.add(sprite);
    const sm = sprite.material as THREE.SpriteMaterial;
    if (sm.map) disposables.push(sm.map);
    disposables.push(sm);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.4;
  controls.rotateSpeed = 0.7;

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  const ro = new ResizeObserver(() => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    disposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
  };
}

export default function BarGrid3DChart({
  data = DEFAULT_DATA,
  xLabels = DEFAULT_X_LABELS,
  yLabels = DEFAULT_Y_LABELS,
  colorMode = "mono",
  randomize = false,
}: {
  data?: number[][];
  xLabels?: string[];
  yLabels?: string[];
  colorMode?: ColorMode;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeData, setActiveData] = useState<number[][]>(data);

  useEffect(() => {
    if (randomize) {
      setActiveData(randomGrid(data.length, data[0]?.length ?? 4, 200));
    }
  }, [randomize, data.length, data]);

  useEffect(() => {
    if (!containerRef.current) return;
    return buildScene(containerRef.current, activeData, colorMode, xLabels, yLabels);
  }, [activeData, colorMode, xLabels, yLabels]);

  const rows = activeData.length;
  const cols = activeData[0]?.length ?? 0;

  const canvas = <div ref={containerRef} className="bargrid3d-chart" />;

  if (!randomize) return canvas;

  return (
    <div className="chart-demo-host">
      <button
        type="button"
        className="chart-demo-reroll"
        onClick={() => setActiveData(randomGrid(rows, cols, 200))}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {canvas}
    </div>
  );
}
