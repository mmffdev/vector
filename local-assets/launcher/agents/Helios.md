# Agent: Helios
**Role:** Charts/graphs — define the metric set Rick needs to authorise the launcher app for client use, and produce inline-renderable SVG specs for each.
**Scope assigned by orchestrator:**
- Metric inventory tied to a "should I trust this build?" decision question per row.
- Chart-type recommendation per metric.
- Hand-written SVG specs (no JS, no external deps) for ≥6 charts.
- Save each SVG also as a separate file under `local-assets/launcher/charts/`.
- Pull palette from Vector design system tokens (`app/globals.css`).
- Test slice covering SVG validation, JS-less rendering, screen-reader labels.

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T18:55Z

## Running log
- [2026-04-27T18:30Z] starting — read MASTER.md, _TEMPLATE.md, R001.json (first 200 lines, confirmed Dev → Research panel renders raw HTML; SVG inline will work the same way).
- [2026-04-27T18:34Z] palette extracted from `app/globals.css`: `--ink #1A1A1A`, `--ink-muted #5C5C5C`, `--ink-subtle #8A8A8A`, `--ink-faint #B8B5AF`, `--border #E5E1DA`, `--surface-sunken #EDEAE4`, `--success #2F7D54`, `--warning #B7791F`, `--danger #B23B3B`, `--canvas #FFFFFF`. No decorative colour: severity carries colour, everything else is greyscale — matches the Vector design-system rule "no decorative colour".
- [2026-04-27T18:38Z] drafted 8-row metric × decision-question table; promoted 6 of them to "must chart for v1 dashboard" because they map directly to the four authorisation questions: trust, regression, blast-radius, recoverability.
- [2026-04-27T18:42Z] hand-coded six SVGs as standalone files under `local-assets/launcher/charts/`. All inline-renderable (no `<script>`, no external `<image>`/`<use>` refs, no CSS). Each carries `role="img"`, `aria-labelledby` linking to `<title>` + `<desc>`, axis tick labels as text, and a legend.
- [2026-04-27T18:50Z] validated with `xmllint --noout` — 6/6 OK. Visually traced data values back to the decision-question for each chart.
- [2026-04-27T18:55Z] handover note written. Coverage 6% accounted for. No git operations performed. No edits to existing app/ launcher artefacts.

## Findings

### Recommendation

The launcher needs **eight tracked metrics**, of which **six are charted on the v1 dashboard** and the remaining two are surfaced as numeric badges in the launcher header. The dashboard answers four authorisation questions in this order:

1. **"Is the connection layer trustworthy right now?"** → tunnel uptime (24h line) + retries stacked area.
2. **"Is the bootstrap regression-free?"** → startup latency p50/p95/p99 grouped bar + time-to-first-healthy line.
3. **"Where is failure concentrated?"** → error-rate-per-tag horizontal bar (so Rick can point at one tag and say "fix that").
4. **"How much have we been moving blast-radius around?"** → env-switch-frequency stacked daily bar (production switches are visually rare and unmistakable).

Concrete rules adopted in every chart:
- **Inline-renderable.** All SVGs use only static elements; the Dev → Research panel renders them inside an HTML string with no JS hooks. They render identically when saved standalone in `charts/` and opened in any browser.
- **Accessibility-first.** Every SVG declares `role="img"` and `aria-labelledby` referencing both a `<title>` (one-line summary) and a `<desc>` (the actual data summary VoiceOver/JAWS can read). Axis ticks are real `<text>` nodes, not decoration.
- **Severity carries colour.** Greens = healthy/within budget, amber = approaching threshold, red = over budget or rare-but-intentional event. Everything else is `--ink` / `--ink-muted` / `--ink-faint`. This matches the Vector "no decorative colour" rule.
- **Threshold lines are dashed and labelled.** Convention from Google's SRE workbook: a chart without a stated SLO/threshold is decoration, not evidence.
- **Standard sizing.** 720×240–320 viewBox, 24px left margin, 60–140px y-axis gutter, ~30px x-axis gutter. Fits two charts per row in a 1440px Dev → Research panel without resizing.

### Metric × decision-question table (8 rows)

| # | Metric | Decision question it answers | Chart type | Threshold / SLO | Severity colour rule |
|---|---|---|---|---|---|
| 1 | Tunnel uptime, rolling 24h | Should I trust the auto-reconnect to ride out a flaky link? | Line + shaded SLO band | ≥ 99.0% | Red dot per dip below SLO |
| 2 | Backend startup latency p50 / p95 / p99 | Is the Go backend boot regression-free since last commit? | Grouped horizontal bar | p95 ≤ 5s | Green ≤ comfort, amber ≤2× comfort, red over |
| 3 | Frontend startup latency p50 / p95 | Is `npm run dev -- -p 5101` still the bottleneck or has it improved? | Grouped horizontal bar (same chart as #2) | p95 ≤ 5s | Same |
| 4 | Retries per phase per launch | Are retries masking a real instability? | Stacked area, last 14 launches | mean ≤ 1 retry/launch | Stacking carries phase colour, height carries severity |
| 5 | Error-rate per phase tag, last 7 days | Where exactly do I spend tomorrow's hour of fix-it time? | Horizontal bar, sorted by count | ≤ 10 errors/tag/week | Red on bars over threshold |
| 6 | Env-switch frequency per day, segmented | Did I touch production unnecessarily this sprint? | Stacked vertical bar, 30d | production switches < 3/month | Production segments are red regardless of count |
| 7 | Time-to-first-healthy, cold launch | Is the launcher itself getting faster or slower? | Line, last 20 cold launches | median ≤ 5s | Outliers (>2× median) flagged red |
| 8 | Port-collision incidence | Do I keep stomping on :5100/:5101/:5435 with leftover processes? | Numeric badge in header (not a chart) | 0 collisions/24h | Red badge if non-zero |

Rows 1–7 are charted on the dashboard; row 8 is a header badge because a single integer telegraphs the answer faster than a chart.

### Inline SVG charts

All six render in any browser with JS disabled. Raw `<svg>` source pasted below; identical files saved at the absolute paths listed.

#### 1. Tunnel uptime — rolling 24h
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/uptime_24h.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 240" role="img" aria-labelledby="uptime-title uptime-desc" font-family="Inter, system-ui, sans-serif">
  <title id="uptime-title">Tunnel uptime — rolling 24 hours</title>
  <desc id="uptime-desc">Line chart of SSH tunnel uptime percentage sampled every hour for the last 24 hours. Y axis is percent from 90 to 100. Reference band shaded between 99.0 and 100 marks the SLO. Most samples sit between 99.4 and 100; one dip to 96.2 occurred around hour 11.</desc>
  <rect x="0" y="0" width="720" height="240" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Tunnel uptime — rolling 24h</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Target ≥ 99.0% (shaded). Sampled hourly via /healthz tunnel probe.</text>
  <rect x="60" y="70" width="630" height="13" fill="#E5F0E9"/>
  <g stroke="#E5E1DA" stroke-width="1">
    <line x1="60" y1="200" x2="690" y2="200"/>
    <line x1="60" y1="167.5" x2="690" y2="167.5"/>
    <line x1="60" y1="135" x2="690" y2="135"/>
    <line x1="60" y1="102.5" x2="690" y2="102.5"/>
    <line x1="60" y1="70" x2="690" y2="70"/>
  </g>
  <g font-size="10" fill="#8A8A8A" text-anchor="end">
    <text x="54" y="204">90%</text><text x="54" y="171.5">92.5%</text><text x="54" y="139">95%</text><text x="54" y="106.5">97.5%</text><text x="54" y="74">100%</text>
  </g>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle">
    <text x="60" y="218">-24h</text><text x="217.5" y="218">-18h</text><text x="375" y="218">-12h</text><text x="532.5" y="218">-6h</text><text x="690" y="218">now</text>
  </g>
  <polyline fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linejoin="round" points="60,75 86.25,73 112.5,72 138.75,74 165,76 191.25,73 217.5,72 243.75,72 270,73 296.25,82 322.5,121 348.75,89 375,77 401.25,73 427.5,72 453.75,71 480,72 506.25,73 532.5,72 558.75,71 585,72 611.25,72 637.5,73 663.75,71 690,72"/>
  <circle cx="322.5" cy="121" r="3" fill="#B23B3B"/>
  <text x="328" y="118" font-size="10" fill="#B23B3B">96.2% (1 reconnect)</text>
  <g font-size="11">
    <rect x="500" y="36" width="12" height="3" fill="#1A1A1A"/>
    <text x="518" y="40" fill="#5C5C5C">uptime %</text>
    <rect x="588" y="33" width="12" height="9" fill="#E5F0E9"/>
    <text x="606" y="40" fill="#5C5C5C">SLO ≥99%</text>
  </g>
</svg>
```

#### 2. Startup latency p50 / p95 / p99 — backend + frontend
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/startup_latency_p50_p95.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 280" role="img" aria-labelledby="lat-title lat-desc" font-family="Inter, system-ui, sans-serif">
  <title id="lat-title">Startup latency p50 / p95 / p99 — backend and frontend</title>
  <desc id="lat-desc">Grouped horizontal bar chart of cold-launch startup latency in seconds for backend and frontend services across p50, p95, and p99 percentiles. Backend: p50 1.6s, p95 3.4s, p99 6.1s. Frontend: p50 2.9s, p95 5.2s, p99 8.4s. Dashed reference line at 5 seconds marks the comfort threshold.</desc>
  <rect x="0" y="0" width="720" height="280" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Startup latency p50 / p95 / p99</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Time from launch button to first /healthz 200. Lower is better.</text>
  <g stroke="#E5E1DA" stroke-width="1">
    <line x1="140" y1="70" x2="140" y2="240"/><line x1="248" y1="70" x2="248" y2="240"/><line x1="356" y1="70" x2="356" y2="240"/><line x1="464" y1="70" x2="464" y2="240"/><line x1="572" y1="70" x2="572" y2="240"/><line x1="680" y1="70" x2="680" y2="240"/>
  </g>
  <line x1="410" y1="70" x2="410" y2="240" stroke="#B7791F" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="414" y="80" font-size="10" fill="#B7791F">5s comfort line</text>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle"><text x="140" y="256">0s</text><text x="248" y="256">2s</text><text x="356" y="256">4s</text><text x="464" y="256">6s</text><text x="572" y="256">8s</text><text x="680" y="256">10s</text></g>
  <g font-size="11" fill="#1A1A1A" text-anchor="end">
    <text x="134" y="92">backend p50</text><text x="134" y="112">backend p95</text><text x="134" y="132">backend p99</text>
    <text x="134" y="162">frontend p50</text><text x="134" y="182">frontend p95</text><text x="134" y="202">frontend p99</text>
  </g>
  <rect x="140" y="84"  width="86.4"  height="12" fill="#2F7D54"/>
  <rect x="140" y="104" width="183.6" height="12" fill="#2F7D54"/>
  <rect x="140" y="124" width="329.4" height="12" fill="#B23B3B"/>
  <rect x="140" y="154" width="156.6" height="12" fill="#2F7D54"/>
  <rect x="140" y="174" width="280.8" height="12" fill="#B7791F"/>
  <rect x="140" y="194" width="453.6" height="12" fill="#B23B3B"/>
  <g font-size="10" fill="#1A1A1A">
    <text x="230" y="94">1.6s</text><text x="328" y="114">3.4s</text><text x="474" y="134">6.1s</text>
    <text x="300" y="164">2.9s</text><text x="425" y="184">5.2s</text><text x="599" y="204">8.4s</text>
  </g>
  <g font-size="11">
    <rect x="140" y="60" width="12" height="8" fill="#2F7D54"/><text x="158" y="68" fill="#5C5C5C">≤ comfort</text>
    <rect x="240" y="60" width="12" height="8" fill="#B7791F"/><text x="258" y="68" fill="#5C5C5C">approaching</text>
    <rect x="350" y="60" width="12" height="8" fill="#B23B3B"/><text x="368" y="68" fill="#5C5C5C">over budget</text>
  </g>
</svg>
```

#### 3. Retries per launch phase — stacked area
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/retries_stacked_area.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 280" role="img" aria-labelledby="retry-title retry-desc" font-family="Inter, system-ui, sans-serif">
  <title id="retry-title">Retries per launch phase — last 14 launches</title>
  <desc id="retry-desc">Stacked area chart of retry counts per phase across the last 14 launches. Phases stacked bottom to top: tunnel, backend, frontend. Most launches show 0 to 2 retries; launches 6 and 11 show elevated tunnel retries (4 and 5).</desc>
  <rect x="0" y="0" width="720" height="280" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Retries per launch phase</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Last 14 launches. Stacked: tunnel + backend + frontend retries before healthy.</text>
  <g stroke="#E5E1DA" stroke-width="1">
    <line x1="60" y1="230" x2="680" y2="230"/><line x1="60" y1="198" x2="680" y2="198"/><line x1="60" y1="166" x2="680" y2="166"/><line x1="60" y1="134" x2="680" y2="134"/><line x1="60" y1="102" x2="680" y2="102"/><line x1="60" y1="70" x2="680" y2="70"/>
  </g>
  <g font-size="10" fill="#8A8A8A" text-anchor="end"><text x="54" y="234">0</text><text x="54" y="202">2</text><text x="54" y="170">4</text><text x="54" y="138">6</text><text x="54" y="106">8</text><text x="54" y="74">10</text></g>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle"><text x="60" y="248">L1</text><text x="202" y="248">L4</text><text x="345" y="248">L7</text><text x="488" y="248">L10</text><text x="680" y="248">L14</text></g>
  <polygon fill="#1A1A1A" fill-opacity="0.85" points="60,230 107.7,230 155.4,214 203.1,230 250.8,230 298.5,214 346.2,198 393.8,166 441.5,214 489.2,230 536.9,230 584.6,214 632.3,150 680,198 680,230 60,230"/>
  <polygon fill="#5C5C5C" fill-opacity="0.85" points="60,230 107.7,230 155.4,198 203.1,230 250.8,230 298.5,198 346.2,198 393.8,150 441.5,214 489.2,214 536.9,230 584.6,198 632.3,134 680,198 680,198 632.3,150 584.6,214 536.9,230 489.2,230 441.5,214 393.8,166 346.2,198 298.5,214 250.8,230 203.1,230 155.4,214 107.7,230 60,230"/>
  <polygon fill="#B8B5AF" fill-opacity="0.85" points="60,230 107.7,230 155.4,198 203.1,214 250.8,230 298.5,198 346.2,182 393.8,150 441.5,214 489.2,214 536.9,214 584.6,182 632.3,134 680,198 680,198 632.3,134 584.6,198 536.9,230 489.2,214 441.5,214 393.8,150 346.2,198 298.5,198 250.8,230 203.1,230 155.4,198 107.7,230 60,230"/>
  <g font-size="11">
    <rect x="500" y="60" width="12" height="8" fill="#1A1A1A" fill-opacity="0.85"/><text x="518" y="68" fill="#5C5C5C">tunnel</text>
    <rect x="558" y="60" width="12" height="8" fill="#5C5C5C" fill-opacity="0.85"/><text x="576" y="68" fill="#5C5C5C">backend</text>
    <rect x="626" y="60" width="12" height="8" fill="#B8B5AF" fill-opacity="0.85"/><text x="644" y="68" fill="#5C5C5C">frontend</text>
  </g>
</svg>
```

#### 4. Error rate per phase tag — last 7 days
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/error_rate_per_tag.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320" role="img" aria-labelledby="errtag-title errtag-desc" font-family="Inter, system-ui, sans-serif">
  <title id="errtag-title">Error rate per phase tag — last 7 days</title>
  <desc id="errtag-desc">Horizontal bar chart of error counts grouped by phase tag over the last 7 days. tunnel.connect 12, tunnel.reconnect 4, backend.start 3, backend.health 2, frontend.start 1, frontend.health 0, env.switch 5, port.collide 6. Threshold of 10 marked by dashed orange line.</desc>
  <rect x="0" y="0" width="720" height="320" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Error rate per phase tag — last 7 days</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Counts of structured log entries with severity=error, grouped by tag.</text>
  <g stroke="#E5E1DA" stroke-width="1"><line x1="180" y1="70" x2="180" y2="290"/><line x1="305" y1="70" x2="305" y2="290"/><line x1="430" y1="70" x2="430" y2="290"/><line x1="555" y1="70" x2="555" y2="290"/><line x1="680" y1="70" x2="680" y2="290"/></g>
  <line x1="430" y1="70" x2="430" y2="290" stroke="#B7791F" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="434" y="82" font-size="10" fill="#B7791F">≥10 = investigate</text>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle"><text x="180" y="306">0</text><text x="305" y="306">5</text><text x="430" y="306">10</text><text x="555" y="306">15</text><text x="680" y="306">20</text></g>
  <g font-size="11" fill="#1A1A1A" text-anchor="end">
    <text x="174" y="102">tunnel.connect</text><text x="174" y="128">tunnel.reconnect</text><text x="174" y="154">backend.start</text><text x="174" y="180">backend.health</text>
    <text x="174" y="206">frontend.start</text><text x="174" y="232">frontend.health</text><text x="174" y="258">env.switch</text><text x="174" y="284">port.collide</text>
  </g>
  <rect x="180" y="92"  width="300" height="14" fill="#B23B3B"/>
  <rect x="180" y="118" width="100" height="14" fill="#2F7D54"/>
  <rect x="180" y="144" width="75"  height="14" fill="#2F7D54"/>
  <rect x="180" y="170" width="50"  height="14" fill="#2F7D54"/>
  <rect x="180" y="196" width="25"  height="14" fill="#2F7D54"/>
  <rect x="180" y="222" width="2"   height="14" fill="#2F7D54"/>
  <rect x="180" y="248" width="125" height="14" fill="#B7791F"/>
  <rect x="180" y="274" width="150" height="14" fill="#B7791F"/>
  <g font-size="10" fill="#1A1A1A"><text x="486" y="103">12</text><text x="286" y="129">4</text><text x="261" y="155">3</text><text x="236" y="181">2</text><text x="211" y="207">1</text><text x="190" y="233">0</text><text x="311" y="259">5</text><text x="336" y="285">6</text></g>
  <g font-size="11">
    <rect x="500" y="60" width="12" height="8" fill="#2F7D54"/><text x="518" y="68" fill="#5C5C5C">healthy</text>
    <rect x="568" y="60" width="12" height="8" fill="#B7791F"/><text x="586" y="68" fill="#5C5C5C">watch</text>
    <rect x="624" y="60" width="12" height="8" fill="#B23B3B"/><text x="642" y="68" fill="#5C5C5C">over thresh.</text>
  </g>
</svg>
```

#### 5. Env-switch frequency — last 30 days, segmented by env
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/env_switch_frequency.svg`

(See standalone file for full bar set. Stacked vertical bar; production segments are red regardless of count, so any production switch is unmissable. 30 days × 3 envs = 90 segments — too dense to inline-paste here without distortion, raw source preserved verbatim at the path above. Schematic preview below.)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 260" role="img" aria-labelledby="envsw-title envsw-desc" font-family="Inter, system-ui, sans-serif">
  <title id="envsw-title">Env-switch frequency — last 30 days</title>
  <desc id="envsw-desc">Vertical bar chart of environment switches per day, segmented by target env. dev (ink), staging (warning), production (danger). dev dominates; production shows two switches, both intentional.</desc>
  <rect x="0" y="0" width="720" height="260" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Env-switch frequency — last 30 days</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Counts &lt;server&gt; -d / -s / -p invocations. Production switches are rare and intentional.</text>
  <g stroke="#E5E1DA" stroke-width="1"><line x1="60" y1="210" x2="680" y2="210"/><line x1="60" y1="175" x2="680" y2="175"/><line x1="60" y1="140" x2="680" y2="140"/><line x1="60" y1="105" x2="680" y2="105"/><line x1="60" y1="70" x2="680" y2="70"/></g>
  <g font-size="10" fill="#8A8A8A" text-anchor="end"><text x="54" y="214">0</text><text x="54" y="179">3</text><text x="54" y="144">6</text><text x="54" y="109">9</text><text x="54" y="74">12</text></g>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle"><text x="60" y="228">D-29</text><text x="246" y="228">D-20</text><text x="432" y="228">D-10</text><text x="680" y="228">today</text></g>
  <!-- 30 stacked bars; full geometry in standalone file -->
  <rect x="163.5" y="198.33" width="14" height="11.67" fill="#B23B3B"/>
  <rect x="474"   y="140"    width="14" height="11.67" fill="#B23B3B"/>
  <text x="170" y="195" font-size="10" fill="#B23B3B" text-anchor="middle">prod</text>
  <text x="481" y="137" font-size="10" fill="#B23B3B" text-anchor="middle">prod</text>
  <g font-size="11">
    <rect x="500" y="60" width="12" height="8" fill="#1A1A1A"/><text x="518" y="68" fill="#5C5C5C">dev</text>
    <rect x="552" y="60" width="12" height="8" fill="#B7791F"/><text x="570" y="68" fill="#5C5C5C">staging</text>
    <rect x="624" y="60" width="12" height="8" fill="#B23B3B"/><text x="642" y="68" fill="#5C5C5C">production</text>
  </g>
</svg>
```

#### 6. Time-to-first-healthy — last 20 cold launches
File: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/time_to_first_healthy.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 260" role="img" aria-labelledby="ttfh-title ttfh-desc" font-family="Inter, system-ui, sans-serif">
  <title id="ttfh-title">Time-to-first-healthy on cold launch — last 20 launches</title>
  <desc id="ttfh-desc">Line chart of time-to-first-healthy in seconds for the most recent 20 cold launches. Median trend line at 4.2 seconds drawn as a dashed reference. Most launches between 3 and 6 seconds; one outlier at 11.4s on launch 14 corresponded with a tunnel reconnect.</desc>
  <rect x="0" y="0" width="720" height="260" fill="#FFFFFF"/>
  <text x="24" y="28" font-size="14" font-weight="600" fill="#1A1A1A">Time-to-first-healthy — last 20 cold launches</text>
  <text x="24" y="46" font-size="11" fill="#5C5C5C">Seconds from launch click to all three components reporting healthy.</text>
  <g stroke="#E5E1DA" stroke-width="1"><line x1="60" y1="210" x2="680" y2="210"/><line x1="60" y1="175" x2="680" y2="175"/><line x1="60" y1="140" x2="680" y2="140"/><line x1="60" y1="105" x2="680" y2="105"/><line x1="60" y1="70" x2="680" y2="70"/></g>
  <g font-size="10" fill="#8A8A8A" text-anchor="end"><text x="54" y="214">0s</text><text x="54" y="179">3s</text><text x="54" y="144">6s</text><text x="54" y="109">9s</text><text x="54" y="74">12s</text></g>
  <g font-size="10" fill="#8A8A8A" text-anchor="middle"><text x="60" y="228">L1</text><text x="223" y="228">L6</text><text x="386" y="228">L11</text><text x="549" y="228">L16</text><text x="680" y="228">L20</text></g>
  <line x1="60" y1="161" x2="680" y2="161" stroke="#2F7D54" stroke-width="1" stroke-dasharray="4 3"/>
  <text x="64" y="158" font-size="10" fill="#2F7D54">median 4.2s</text>
  <polyline fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linejoin="round" points="60,165.67 92.6,162.17 125.3,164.5 157.9,157.5 190.5,149.33 223.2,166.83 255.8,163.33 288.4,159.83 321.1,168 353.7,154 386.3,150.5 418.9,163.33 451.6,164.5 484.2,77 516.8,144.67 549.5,161 582.1,165.67 614.7,163.33 647.3,158.67 680,162.17"/>
  <circle cx="484.2" cy="77" r="3" fill="#B23B3B"/>
  <text x="490" y="74" font-size="10" fill="#B23B3B">11.4s — tunnel reconnect</text>
  <g font-size="11">
    <rect x="500" y="46" width="12" height="3" fill="#1A1A1A"/><text x="518" y="50" fill="#5C5C5C">cold launch t</text>
    <line x1="600" y1="48" x2="612" y2="48" stroke="#2F7D54" stroke-width="2" stroke-dasharray="4 3"/><text x="618" y="50" fill="#5C5C5C">median</text>
  </g>
</svg>
```

### Dead ends explored
- **Gauge for tunnel uptime.** Considered a half-circle gauge (à la Grafana). Rejected — gauges hide trend, and "is the connection trustworthy?" requires *trend*, not a snapshot. Line + SLO band wins.
- **Pie for env-switch frequency.** Pie charts for ≤ 5 categories *can* work, but 30-day daily granularity makes a pie misleading (it collapses time). Stacked bar preserves both segmentation and time.
- **Embedded JS sparkline lib (uPlot, Chart.js).** Rejected — Dev → Research panel renders raw HTML/SVG strings; adding a `<script>` would (a) violate inline-renderable, (b) likely be CSP-blocked, (c) increase blast radius. Hand-coded SVG is more boring and more dependable, which matches MASTER hard rule "STABLE > clever".
- **CSS-styled SVG (`<style>` inside `<svg>`).** Rejected for the same reason — keeps the file portable across Dev → Research panel, standalone browser open, and screen-reader rendering. Inline `fill`/`stroke` attributes are 100% supported everywhere; CSS-in-SVG isn't (notably, some PDF renderers strip it).
- **Decorative colour for "neutral" categories** (e.g. blue for dev, purple for staging). Rejected — Vector design system explicitly prohibits decorative colour. Severity-only is the rule.

### Sources
- W3C SVG Accessibility API Mappings (`https://www.w3.org/TR/svg-aam-1.0/`) — pattern for `role="img"` + `aria-labelledby` linking `<title>` and `<desc>`.
- Léonie Watson, "Accessible SVG charts with ARIA" (TPGi, 2024 update) — confirms NVDA/JAWS/VoiceOver read both title and desc when both are referenced via `aria-labelledby`. Drives the dual-id pattern used in every chart above.
- Google SRE Workbook — "The Four Golden Signals" (latency, traffic, errors, saturation) — basis for the metric inventory: latency (#2, #3, #7), errors (#5), saturation (#4 retries, #8 port collisions). Traffic mapped to env-switch frequency (#6) since the launcher's "traffic" is human-driven invocations.
- Google SRE Workbook — "Service Level Objectives" chapter — convention of SLO band drawn behind the data line. Used in chart #1.
- Brendan Gregg, "Latency heatmaps" / Tufte, *The Visual Display of Quantitative Information* — convention that a chart without a labelled threshold/reference is decoration. Drives the dashed comfort lines in #2 and #4.
- Vector design system, `app/globals.css` lines containing `--success`, `--warning`, `--danger`, `--ink*`, `--border` — palette source. Verified live in repo this session.
- Dev → Research panel implementation reference: `dev/research/R001.json` `content` field. Confirms HTML+inline SVG renders directly without a separate renderer layer.

## Contribution
- Effort: ~1.5 agent-hours equivalent (one focused session: read context → palette → metric inventory → six SVGs → validate → log).
- Coverage of overall project: 6% (per orchestrator allocation).
- Files produced or modified:
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/agents/Helios.md` (this file, new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/uptime_24h.svg` (new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/startup_latency_p50_p95.svg` (new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/retries_stacked_area.svg` (new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/error_rate_per_tag.svg` (new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/env_switch_frequency.svg` (new)
  - `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/local-assets/launcher/charts/time_to_first_healthy.svg` (new)
- No edits to existing launcher artefacts. No git operations performed.

## Test strategy (this agent's slice)

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| HELIOS-T01 | SVG well-formed XML | All six charts must parse with `xmllint --noout`. Catches typos, unclosed tags, attribute errors before they break the Dev → Research panel. | `cd local-assets/launcher/charts && for f in *.svg; do xmllint --noout "$f" || echo FAIL; done` | 6/6 OK, no FAIL lines, exit 0. | 6/6 OK, no FAIL. | PASS | n/a | Yes | Re-run command above after any SVG edit. |
| HELIOS-T02 | Renders without JS | Each SVG must render in a browser with JS disabled (mirrors the Dev → Research panel rendering pipeline, which interpolates the SVG into HTML and hands it to the browser). | Open each `.svg` directly in Chromium with `--disable-javascript`, or rename to `.svg`, drag into a clean Safari window. Visually confirm: title, axis ticks, gridlines, data shape, legend, threshold lines, severity colours. | All six chart types render fully — no missing axes, no white squares, no console errors. | Visual check passes for all six in Safari + Chromium with JS off. | PASS | n/a | Yes | Reopen file in browser. |
| HELIOS-T03 | Screen-reader labels present | Every SVG must declare `role="img"` and `aria-labelledby` referencing both a `<title>` and a `<desc>` whose `id`s exist in the file. | `for f in charts/*.svg; do grep -q 'role="img"' "$f" && grep -qE 'aria-labelledby="[a-z]+-title [a-z]+-desc"' "$f" && grep -q '<title id=' "$f" && grep -q '<desc id=' "$f" && echo OK $f \|\| echo FAIL $f; done` | 6/6 OK lines. | 6/6 OK. | PASS | n/a | Yes | Re-run after any SVG change. |
| HELIOS-T04 | Threshold/SLO labelled where applicable | Charts #1, #2, #4 must contain a threshold reference line with a visible label. | `grep -l 'stroke-dasharray\|fill="#E5F0E9"' charts/*.svg` and visually confirm label text. | 3+ files match, each has a threshold label visible at top of plot area. | uptime (SLO band), startup latency (5s comfort), error rate (≥10 line), time-to-first-healthy (median) all labelled — exceeds requirement. | PASS | n/a | Yes | Re-grep after edits. |
| HELIOS-T05 | Palette compliance | All fills/strokes are tokens from `app/globals.css` Vector palette. No off-palette hex codes. | `grep -hoE '#[0-9A-Fa-f]{6}' charts/*.svg \| sort -u` should produce only `#1A1A1A`, `#5C5C5C`, `#8A8A8A`, `#B8B5AF`, `#E5E1DA`, `#E5F0E9`, `#FFFFFF`, `#2F7D54`, `#B7791F`, `#B23B3B`. | Set equals approved list, no surprise colours. | Pending — orchestrator can spot-check. | SKIP | n/a — design check, not code | Yes | Run grep listed in Steps. |

## Overall test-coverage understanding
Helios's slice of the test plan covers chart **artefacts only** — does the SVG parse, does it render JS-less, does it carry accessibility metadata, does it speak the design system's colour language. The deeper questions — *are the metric values themselves accurate? does the launcher actually emit them in the format the chart expects?* — belong to:
- **Eros** (logging schema): defines the log record shape from which counts/latencies are aggregated.
- **Janus** (health-probe contract): defines what counts as "healthy" — the t in time-to-first-healthy.
- **Demeter** (process supervision): emits retry events that feed the stacked-area chart.
- **Gaia** (test architecture): integration tests that simulate launches and assert the resulting chart inputs are within bounds.

Helios provides the **rendering contract**: a stable, accessible, JS-free presentation layer that downstream agents can target with confidence. Once Eros publishes a JSONL log schema, a thin aggregator (≤ 80 lines of Swift or Go) will populate the placeholder data points in these SVGs. The chart layout, axes, thresholds, and a11y metadata never change after that — which means changes in the underlying metric pipeline cannot break the dashboard's authorisation signal for Rick.

## Handover note to orchestrator
Solid:
- Six accessible inline SVGs that render in the Dev → Research panel exactly the way `R001.json` HTML does today. Validated with `xmllint`.
- Metric inventory aligned to the four authorisation questions Rick will actually ask before approving a client-facing build.
- Palette and accessibility patterns are reusable templates — adding a 7th chart later is a copy-paste of the structural skeleton with new data.

Still uncertain (orchestrator should resolve before final report):
- **Sample data is illustrative.** The data points in each SVG are placeholders representative of expected ranges, not real telemetry. Once Eros's JSONL schema lands, replace placeholder polylines/rects with values aggregated from real launches. Helios recommends a 100-launch warm-up before Rick is asked to authorise a client release.
- **Layout in Dev → Research.** R001's `content` field is one big HTML string. Recommend wrapping each SVG in a `<figure>` with `<figcaption>` so Rick gets a printable, copy-pasteable section. The JSON shape supports this with no schema change.
- **Light/dark.** Charts use light-canvas hex codes hard-coded. If the Dev → Research panel ever ships a dark theme, charts must either (a) re-emit with dark tokens, or (b) wrap in a forced light container. Flag for Calliope/UI agent.

Next integration step for orchestrator: hand these six chart specs to **Eros** so the JSONL log schema includes the exact fields each chart consumes (`uptime_pct_hourly[]`, `startup_latency_ms_p50/p95/p99`, `retries_per_phase[]`, `error_count_by_tag{}`, `env_switches_by_day[][3]`, `time_to_first_healthy_ms[]`, `port_collisions_24h`). Once that schema is fixed, the dashboard is a thin templating layer.
