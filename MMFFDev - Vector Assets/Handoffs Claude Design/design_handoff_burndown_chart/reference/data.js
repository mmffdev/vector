/* =============================================================
   Vector — shared sprint dataset + burndown/burnup math
   One source of truth so all 20 charts tell the same story.
   ============================================================= */
(function () {
  // ---- Raw sprint facts (a 2-week sprint = 10 working days) ----
  const SPRINT_DAYS = 10;              // D1..D10, plus Day 0 = start baseline
  const TODAY = 7;                     // we have actuals through Day 7
  const BASE_COMMIT = 80;              // story points committed on Day 0
  const SCOPE_DAY = 5;                 // mid-sprint scope change lands on Day 5
  const SCOPE_DELTA = 12;              // +12 pts of artefacts pulled in

  // Daily ACCEPTED story points (velocity), Day 0..7. Day 0 = nothing yet.
  const accepted = [0, 4, 6, 8, 7, 5, 9, 9];

  // Status-palette colours sampled from the screenshot chips
  const C = {
    ink: '#1A1A1A', inkMuted: '#5C5C5C', inkSubtle: '#8A8A8A', inkFaint: '#B8B5AF',
    border: '#E5E1DA', borderStrong: '#D4CFC5',
    canvas: '#F4F2EE', surface: '#FFFFFF', sunken: '#EDEAE4',
    red: '#E5392B',        // brand accent — the hero "Actual" series
    redSoft: 'rgba(229,57,43,0.12)',
    green: '#2F7D54',      // optimistic
    greenSoft: 'rgba(47,125,84,0.14)',
    amber: '#B7791F',      // pessimistic
    amberSoft: 'rgba(183,121,31,0.16)',
    blue: '#2F5F8A',       // scope / reference
    // colourful-variant palette (status chips)
    purple: '#7C5CFC', orange: '#EA6A1E', teal: '#149E8E',
    pink: '#D6418A', cyan: '#1399C6', lime: '#6FA522',
  };

  function cumulative(arr) {
    const out = []; let s = 0;
    for (const v of arr) { s += v; out.push(s); }
    return out;
  }

  // Build the full derived model. scopeOn toggles the mid-sprint scope change.
  function build(scopeOn) {
    const delta = scopeOn ? SCOPE_DELTA : 0;
    const completedCum = cumulative(accepted); // Day 0..7

    // scope (total committed) by day
    const scope = [];
    for (let d = 0; d <= SPRINT_DAYS; d++) scope.push(BASE_COMMIT + (d >= SCOPE_DAY ? delta : 0));
    const finalScope = scope[SPRINT_DAYS];

    // actuals (Day 0..TODAY)
    const completed = [];   // burn-UP actual
    const remaining = [];   // burn-DOWN actual
    for (let d = 0; d <= SPRINT_DAYS; d++) {
      if (d <= TODAY) {
        completed[d] = completedCum[d];
        remaining[d] = scope[d] - completedCum[d];
      } else { completed[d] = null; remaining[d] = null; }
    }

    // recent velocity (avg accepted over last 3 actual days)
    const last3 = accepted.slice(TODAY - 2, TODAY + 1);
    const vel = last3.reduce((a, b) => a + b, 0) / last3.length;
    const daysLeft = SPRINT_DAYS - TODAY;
    const remToday = remaining[TODAY];
    const compToday = completed[TODAY];

    // ---- Ideal / optimum guideline (re-baselines at the scope change) ----
    // Returns array of {day,val} points; a null val marks a deliberate break.
    const idealPts = [];
    if (scopeOn) {
      // Segment A: Day 0..SCOPE_DAY on the original 80->0 slope
      const slopeA = BASE_COMMIT / SPRINT_DAYS; // 8/day
      for (let d = 0; d <= SCOPE_DAY; d++) idealPts.push({ day: d, val: BASE_COMMIT - slopeA * d });
      idealPts.push({ day: SCOPE_DAY, val: null });        // break — the re-baseline jump
      // Segment B: from re-based value at SCOPE_DAY down to 0 at the end
      const startB = (BASE_COMMIT - slopeA * SCOPE_DAY) + delta; // 40 + 12 = 52
      const slopeB = startB / (SPRINT_DAYS - SCOPE_DAY);
      for (let d = SCOPE_DAY; d <= SPRINT_DAYS; d++) idealPts.push({ day: d, val: startB - slopeB * (d - SCOPE_DAY) });
    } else {
      const slope = BASE_COMMIT / SPRINT_DAYS;
      for (let d = 0; d <= SPRINT_DAYS; d++) idealPts.push({ day: d, val: BASE_COMMIT - slope * d });
    }
    // faint original guideline (always 80->0) for the scope-marker variant
    const idealOriginal = [];
    for (let d = 0; d <= SPRINT_DAYS; d++) idealOriginal.push({ day: d, val: BASE_COMMIT - (BASE_COMMIT / SPRINT_DAYS) * d });

    // ideal burn-UP = scope - ideal-remaining (kept consistent with burndown)
    const idealUpPts = idealPts.map(p => p.val == null ? { day: p.day, val: null } : { day: p.day, val: scope[p.day] - p.val });

    // ---- Forecast cone from "today" ----
    // Optimistic: clears remaining evenly -> hits 0 at sprint end (on track)
    // Pessimistic: continues at recent velocity -> ends above zero (behind)
    const optDownEnd = 0;
    const pessDownEnd = Math.max(0, remToday - vel * daysLeft);
    const optDown = [], pessDown = [], optUp = [], pessUp = [];
    for (let d = TODAY; d <= SPRINT_DAYS; d++) {
      const t = (d - TODAY) / daysLeft;
      const od = remToday + (optDownEnd - remToday) * t;
      const pd = remToday + (pessDownEnd - remToday) * t;
      optDown.push({ day: d, val: od });
      pessDown.push({ day: d, val: pd });
      optUp.push({ day: d, val: scope[d] - od });
      pessUp.push({ day: d, val: scope[d] - pd });
    }

    // arrays indexed by day (null where undefined) — used by hover read-out
    const toArr = (pts) => { const a = new Array(SPRINT_DAYS + 1).fill(null); pts.forEach(p => { if (p.val != null) a[p.day] = p.val; }); return a; };

    return {
      C, SPRINT_DAYS, TODAY, SCOPE_DAY, scopeOn, finalScope, baseCommit: BASE_COMMIT,
      vel, daysLeft, remToday, compToday,
      accepted,
      scope, completed, remaining,
      idealPts, idealOriginal, idealUpPts,
      optDown, pessDown, optUp, pessUp,
      // day-indexed lookups for tooltips
      lookup: {
        ideal: toArr(idealPts), idealUp: toArr(idealUpPts),
        optDown: toArr(optDown), pessDown: toArr(pessDown),
        optUp: toArr(optUp), pessUp: toArr(pessUp),
        scope: scope.slice(),
      },
      // headline figures
      kpis: {
        committed: finalScope,
        remaining: remToday,
        completed: compToday,
        velocity: vel,
        daysLeft,
        onTrack: pessDownEnd <= 0,
        projectedShort: Math.round(pessDownEnd), // pts likely unfinished
      },
    };
  }

  window.SprintData = { build, C, SPRINT_DAYS, TODAY, SCOPE_DAY };
})();
