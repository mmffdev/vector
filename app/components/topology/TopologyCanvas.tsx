"use client";

// PLA-0006/00332 — ReactFlow canvas + bottom-center zoom controls lifted
// out of page.tsx. Pure presentational; the parent owns rfNodes/rfEdges
// + change handlers and forwards the canvas DOM ref via canvasRef.

import { forwardRef } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import { paletteColour, type OrgNodeData } from "./types";

type Props = {
  nodes: Node<OrgNodeData>[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange<Node<OrgNodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodeClick: (e: React.MouseEvent, node: Node<OrgNodeData>) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: Node<OrgNodeData>) => void;
  onInit: (inst: ReactFlowInstance<Node<OrgNodeData>, Edge>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export const TopologyCanvas = forwardRef<HTMLDivElement, Props>(function TopologyCanvas(
  { nodes, edges, nodeTypes, onNodesChange, onEdgesChange, onNodeClick, onNodeContextMenu, onInit, onZoomIn, onZoomOut },
  ref,
) {
  return (
    <div ref={ref} className="topo-overlay__canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onInit={onInit}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.5}
        snapToGrid
        snapGrid={[10, 10]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
      >
        <Background gap={20} size={1} color="#e5e7eb" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeColor={(n) => {
            const data = n.data as OrgNodeData;
            return data?.org?.colour || paletteColour(data?.org?.id ?? n.id);
          }}
          nodeColor={(n) => {
            const data = n.data as OrgNodeData;
            return data?.org?.colour || paletteColour(data?.org?.id ?? n.id);
          }}
        />
      </ReactFlow>
      <div className="topo-overlay__zoom" role="group" aria-label="Zoom canvas">
        <button
          type="button"
          className="btn btn--icon btn--ghost btn--sm topo-overlay__zoom-btn"
          onClick={onZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost btn--sm topo-overlay__zoom-btn"
          onClick={onZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
    </div>
  );
});
