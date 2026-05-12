"use client";

import { useMemo } from "react";
import type { FlowState, FlowTransition } from "@/app/lib/flowStatesApi";
import { countOutbound, type RuleKey } from "./rules";

export type RoutesLinesViewProps = {
  states: FlowState[];          // already sorted by sort_order
  transitions: FlowTransition[];
  rules: Set<RuleKey>;
};

const LINE_PALETTE = [
  "#B89968", "#A47261", "#7C97B1", "#7C9A7E",
  "#A38AB1", "#8C6B4F", "#B58A8A", "#6F8F86",
];

type Track = {
  id: string;
  colour: string;
  arrowColour: string;
  fromIdx: number;
  toIdx: number;
};

const ROW_H = 38;
const TRACK_W = 28;
const PIP_R = 7;
const ARROW_H = 7;

function TrackGroup({ tracks, states, label, labelClass, pipNumber }: {
  tracks: Track[];
  states: FlowState[];
  label: string;
  labelClass: string;
  pipNumber: Map<string, number>;
}) {
  const w = Math.max(tracks.length * TRACK_W, TRACK_W);
  const h = states.length * ROW_H;
  return (
    <div className="routes-lines__group">
      <p className={`routes-lines__group-label ${labelClass}`}>{label}</p>
      <div className="routes-lines__tracks" style={{ width: w, height: h }}>
        {tracks.length === 0 ? (
          <span className="routes-lines__empty">None</span>
        ) : tracks.map((tr, i) => {
            const n = pipNumber.get(tr.id) ?? 1;
            const cx = (i + 0.5) * TRACK_W;
            const y1 = (tr.fromIdx + 0.5) * ROW_H;
            const y2 = (tr.toIdx + 0.5) * ROW_H;
            const goingDown = y2 >= y1;
            const segEnd = goingDown ? y2 - PIP_R : y2 + PIP_R;
            const top = Math.min(y1, segEnd);
            const height = Math.abs(segEnd - y1);
            const arrowTop = goingDown ? y2 - PIP_R - ARROW_H : y2 + PIP_R;
            return (
              <div key={tr.id} className="routes-lines__track" style={{ left: cx - TRACK_W / 2, width: TRACK_W }}>
                <span className="routes-lines__segment-v" style={{ top, height, background: tr.colour }} aria-hidden />
                <span
                  className={`routes-lines__arrow-v${goingDown ? "" : " routes-lines__arrow-v--up"}`}
                  style={{
                    top: arrowTop,
                    borderTopColor: goingDown ? tr.colour : "transparent",
                    borderBottomColor: goingDown ? "transparent" : tr.colour,
                  }}
                  aria-hidden
                />
                <span className="routes-lines__stop routes-lines__stop--source" style={{ top: y1, background: tr.colour }} aria-label={`From ${states[tr.fromIdx].name}`}>
                  {n}
                </span>
                <span className="routes-lines__stop routes-lines__stop--target" style={{ top: y2, background: tr.colour }} aria-label={`To ${states[tr.toIdx].name}`} />
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default function RoutesLinesView({ states, transitions, rules }: RoutesLinesViewProps) {
  const { happy, unhappy } = useMemo(() => {
    const stateIdx = new Map(states.map((s, i) => [s.id, i]));
    const all = transitions
      .map((t): { fromIdx: number; toIdx: number; id: string } | null => {
        const fromIdx = stateIdx.get(t.from);
        const toIdx = stateIdx.get(t.to);
        if (fromIdx == null || toIdx == null || fromIdx === toIdx) return null;
        return { fromIdx, toIdx, id: `${t.from}>${t.to}` };
      })
      .filter((t): t is { fromIdx: number; toIdx: number; id: string } => t !== null)
      .sort((a, b) => a.fromIdx - b.fromIdx || a.toIdx - b.toIdx)
      .map((t) => ({ ...t, colour: LINE_PALETTE[t.fromIdx % LINE_PALETTE.length], arrowColour: "" }));

    return {
      happy:   all.filter((t) => t.toIdx > t.fromIdx).map((t) => ({ ...t, arrowColour: "#4caf50" })),
      unhappy: all.filter((t) => t.toIdx < t.fromIdx).map((t) => ({ ...t, arrowColour: "#e05252" })),
    };
  }, [states, transitions]);

  if (states.length < 2) return null;

  // Number pips continuously per source row across both groups: happy first, then unhappy.
  const pipNumber = new Map<string, number>();
  const rowCount  = new Map<number, number>();
  for (const tr of [...happy, ...unhappy]) {
    const n = (rowCount.get(tr.fromIdx) ?? 0) + 1;
    rowCount.set(tr.fromIdx, n);
    pipNumber.set(tr.id, n);
  }

  return (
    <div className="routes-lines">
      <p className="flow-rules__eyebrow">TRANSITION MAP</p>
      <div className="routes-lines__grid">
        <ul className="routes-lines__states">
          {states.map((s) => (
            <li className="routes-lines__state-row" key={s.id} style={{ height: ROW_H }}>
              <span className="routes-lines__state-dot" style={{ background: s.colour ?? "var(--ink-subtle)" }} aria-hidden />
              <span className="routes-lines__state-name">{s.name}</span>
            </li>
          ))}
        </ul>
        <ul className="routes-lines__counts">
          {states.map((s) => {
            const count = countOutbound(rules, s.id);
            return (
              <li key={s.id} className="routes-lines__count-row" style={{ height: ROW_H }}>
                <span className="flow-rules__rail-count" aria-label={`${count} outbound rules`}>{count}</span>
              </li>
            );
          })}
        </ul>
        <div className="routes-lines__groups">
          <TrackGroup tracks={happy}   states={states} label="" labelClass="routes-lines__group-label--happy"   pipNumber={pipNumber} />
          <TrackGroup tracks={unhappy} states={states} label="" labelClass="routes-lines__group-label--unhappy" pipNumber={pipNumber} />
        </div>
      </div>
    </div>
  );
}
