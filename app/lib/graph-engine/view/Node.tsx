"use client";

// Single node — absolutely-positioned div sized to the laid-out rect.
// Class hooks let the host accordion / future views theme nodes by role
// (root / leaf / generic) without the engine knowing about portfolios.

import { useEffect, useRef } from "react";
import type { LaidOutNode } from "../types";

interface NodeProps {
  node: LaidOutNode;
}

export default function Node({ node }: NodeProps) {
  const isRoot = node.data?.isRoot === true;
  const isLeaf = node.data?.isLeaf === true;
  const cls =
    "ge-node graph-node-pos" +
    (isRoot ? " ge-node--root" : "") +
    (isLeaf ? " ge-node--leaf" : "");
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--node-x", `${node.x}px`);
    el.style.setProperty("--node-y", `${node.y}px`);
    el.style.setProperty("--node-w", `${node.w}px`);
    el.style.setProperty("--node-h", `${node.h}px`);
  }, [node.x, node.y, node.w, node.h]);
  return (
    <div ref={ref} className={cls}>
      <span className="ge-node__label">{node.label}</span>
    </div>
  );
}
