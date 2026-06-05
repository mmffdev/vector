"use client";

/**
 * SprintBurndownChart — dumb SVG renderer for the sprint burndown.
 * Takes the neutral sprintmetrics.Model, runs buildBurndownView() for
 * geometry, and spreads the result onto hand-built SVG. No data fetch,
 * no business logic, no colour literals — every stroke/fill is a
 * --chart-* / --ink / --surface token defined in globals.css.
 *
 * Draw order follows the Aperture rule: connectors / regions / lines
 * FIRST, dots / pins LAST, so markers always sit above the lines.
 */
import type { SprintMetricsModel } from "@/app/lib/apiSite";
import { buildBurndownView, VB } from "@/app/components/charts/sprint/buildBurndownView";

const GRID_VALS = [0, 20, 40, 60, 80, 100];

export function SprintBurndownChart({ model }: { model: SprintMetricsModel }) {
  const v = buildBurndownView(model);
  const k = model.kpis;
  const days = model.window.sprint_days;
  const plotRight = VB.plotL + VB.plotW; // 544
  const plotBottom = VB.plotT + VB.plotH; // 274

  const dayTicks = Array.from({ length: days + 1 }, (_, i) => i);

  return (
    <div className="sprint-burndown">
      {/* KPI strip */}
      <div className="sprint-burndown__kpis">
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.committed}</span>
          <span className="sprint-burndown__kpi-label">Committed</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.remaining}</span>
          <span className="sprint-burndown__kpi-label">Remaining</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.velocity}</span>
          <span className="sprint-burndown__kpi-label">Velocity</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.days_left}</span>
          <span className="sprint-burndown__kpi-label">Days left</span>
        </div>
        <span
          className={
            "sprint-burndown__pill " +
            (k.on_track ? "sprint-burndown__pill--ok" : "sprint-burndown__pill--warn")
          }
        >
          {k.on_track ? "On track" : `~${k.projected_short} pts short`}
        </span>
      </div>

      <svg
        className="sprint-burndown__svg"
        viewBox={`0 0 ${VB.W} ${VB.H}`}
        width="100%"
        height={VB.H}
        role="img"
        aria-label="Sprint burndown chart"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="sbGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="sprint-burndown__grad-0" />
            <stop offset="1" className="sprint-burndown__grad-1" />
          </linearGradient>
        </defs>

        {/* 1. gridlines + axis labels */}
        {GRID_VALS.map((val) => {
          const gy = v.y(val);
          return (
            <g key={`grid-${val}`}>
              <line
                className={
                  "sprint-burndown__grid" +
                  (val === 0 ? " sprint-burndown__grid--zero" : "")
                }
                x1={VB.plotL}
                y1={gy}
                x2={plotRight}
                y2={gy}
              />
              <text
                className="sprint-burndown__axis"
                x={VB.plotL - 6}
                y={gy + 3}
                textAnchor="end"
              >
                {val}
              </text>
            </g>
          );
        })}
        {dayTicks.map((d) => (
          <text
            key={`xtick-${d}`}
            className="sprint-burndown__axis"
            x={v.x(d)}
            y={plotBottom + 16}
            textAnchor="middle"
          >
            {d === 0 ? "S" : d}
          </text>
        ))}

        {/* 2. scope region */}
        {v.scopeRegionX !== null && (
          <rect
            className="sprint-burndown__scope-region"
            x={v.scopeRegionX}
            y={VB.plotT}
            width={plotRight - v.scopeRegionX}
            height={VB.plotH}
          />
        )}

        {/* 3. cone band */}
        {v.conePolygon && (
          <polygon className="sprint-burndown__cone" points={v.conePolygon} />
        )}

        {/* 4. area fill under actual */}
        {v.areaPath && (
          <path className="sprint-burndown__area" d={v.areaPath} fill="url(#sbGrad)" />
        )}

        {/* 5. faint original ideal */}
        {v.idealOriginalPath && (
          <path className="sprint-burndown__ideal-original" d={v.idealOriginalPath} />
        )}

        {/* 6. ideal A + B */}
        {v.idealPathA && <path className="sprint-burndown__ideal" d={v.idealPathA} />}
        {v.idealPathB && <path className="sprint-burndown__ideal" d={v.idealPathB} />}

        {/* 7. forecast cone bounds */}
        {v.optimisticPath && (
          <path className="sprint-burndown__optimistic" d={v.optimisticPath} />
        )}
        {v.pessimisticPath && (
          <path className="sprint-burndown__pessimistic" d={v.pessimisticPath} />
        )}

        {/* 8. today line */}
        <line
          className="sprint-burndown__today"
          x1={v.todayX}
          y1={VB.plotT}
          x2={v.todayX}
          y2={plotBottom}
        />
        <text
          className="sprint-burndown__today-label"
          x={v.todayX}
          y={VB.plotT - 4}
          textAnchor="middle"
        >
          TODAY
        </text>

        {/* 9. actual line */}
        {v.actualPath && <path className="sprint-burndown__actual" d={v.actualPath} />}

        {/* 10. markers */}
        {v.markers.map((p, i) => (
          <circle
            key={`marker-${i}`}
            className="sprint-burndown__marker"
            cx={p.x}
            cy={p.y}
            r={3}
          />
        ))}

        {/* 11. scope pins (line + bubble + label) */}
        {v.scopePins.map((pin, i) => (
          <g key={`pin-${i}`}>
            <line
              className="sprint-burndown__pin-line"
              x1={pin.x}
              y1={VB.plotT}
              x2={pin.x}
              y2={plotBottom}
            />
            <circle className="sprint-burndown__pin" cx={pin.x} cy={pin.y} r={8} />
            <text
              className="sprint-burndown__pin-label"
              x={pin.x}
              y={pin.y + 3}
              textAnchor="middle"
            >
              {pin.label}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="sprint-burndown__legend">
        <span className="sprint-burndown__legend-item">
          <span className="sprint-burndown__swatch sprint-burndown__swatch--actual" />
          Actual
        </span>
        <span className="sprint-burndown__legend-item">
          <span className="sprint-burndown__swatch sprint-burndown__swatch--ideal" />
          Ideal
        </span>
        <span className="sprint-burndown__legend-item">
          <span className="sprint-burndown__swatch sprint-burndown__swatch--optimistic" />
          Optimistic
        </span>
        <span className="sprint-burndown__legend-item">
          <span className="sprint-burndown__swatch sprint-burndown__swatch--pessimistic" />
          Pessimistic
        </span>
        <span className="sprint-burndown__legend-item">
          <span className="sprint-burndown__swatch sprint-burndown__swatch--scope" />
          Scope change
        </span>
      </div>
    </div>
  );
}

export default SprintBurndownChart;
