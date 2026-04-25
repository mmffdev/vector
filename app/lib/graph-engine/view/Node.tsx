"use client";

// Single node — absolutely-positioned div sized to the laid-out rect.
// Class hooks let the host accordion / future views theme nodes by role
// (root / leaf / generic) without the engine knowing about portfolios.

import type { LaidOutNode } from "../types";

interface NodeProps {
  node: LaidOutNode;
}

export default function Node({ node }: NodeProps) {
  const isRoot = node.data?.isRoot === true;
  const isLeaf = node.data?.isLeaf === true;
  const cls =
    "ge-node" +
    (isRoot ? " ge-node--root" : "") +
    (isLeaf ? " ge-node--leaf" : "");
  return (
    <div
      className={cls}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
      }}
    >
      <span className="ge-node__label">{node.label}</span>
    </div>
  );
}
