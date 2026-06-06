/* =============================================================
   Vector ChartKit — single SVG engine, driven by per-chart config.
   Every variation is the same renderer with different feature flags,
   so filters + hover tooltips behave identically across all 20.
   ============================================================= */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const YMAX = 100;
  const TICKS = [0, 20, 40, 60, 80, 100];

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // ---- path builders -------------------------------------------------
  function segs(pts) { // split on null vals -> list of contiguous runs
    const out = []; let cur = [];
    for (const p of pts) {
      if (p == null || p.val == null) { if (cur.length) { out.push(cur); cur = []; } }
      else cur.push(p);
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function linePath(pts, x, y, smooth) {
    let d = '';
    for (const run of segs(pts)) {
      if (!smooth || run.length < 3) {
        run.forEach((p, i) => { d += (i ? 'L' : 'M') + x(p.day).toFixed(1) + ' ' + y(p.val).toFixed(1) + ' '; });
      } else {
        d += 'M' + x(run[0].day).toFixed(1) + ' ' + y(run[0].val).toFixed(1) + ' ';
        for (let i = 0; i < run.length - 1; i++) {
          const p0 = run[i - 1] || run[i], p1 = run[i], p2 = run[i + 1], p3 = run[i + 2] || p2;
          const c1x = x(p1.day) + (x(p2.day) - x(p0.day)) / 6, c1y = y(p1.val) + (y(p2.val) - y(p0.val)) / 6;
          const c2x = x(p2.day) - (x(p3.day) - x(p1.day)) / 6, c2y = y(p2.val) - (y(p3.val) - y(p1.val)) / 6;
          d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + x(p2.day).toFixed(1) + ' ' + y(p2.val).toFixed(1) + ' ';
        }
      }
    }
    return d.trim();
  }
  function areaPath(pts, x, y, baseY, smooth) {
    const run = segs(pts)[0]; if (!run) return '';
    let d = linePath(pts, x, y, smooth);
    const last = run[run.length - 1], first = run[0];
    d += 'L' + x(last.day).toFixed(1) + ' ' + baseY.toFixed(1) + ' L' + x(first.day).toFixed(1) + ' ' + baseY.toFixed(1) + ' Z';
    return d;
  }

  // ---- main factory --------------------------------------------------
  // create(container, config, state) renders into container.
  function create(container, config, state) {
    const D = window.SprintData.build(state.scopeOn);
    const C = D.C;
    const f = state.filters;
    const dark = !!config.dark;
    const compact = !!config.compact;

    // theme
    const theme = dark
      ? { card: '#232120', ink: '#F4F2EE', muted: '#B0ADA6', subtle: '#8A8780', grid: '#3A3733', axis: '#4A4744', sunken: '#2C2A28' }
      : { card: '#FFFFFF', ink: C.ink, muted: C.inkMuted, subtle: C.inkSubtle, grid: C.border, axis: C.borderStrong, sunken: C.sunken };

    // series colour resolution
    let col;
    if (config.mono) {
      col = { ideal: theme.subtle, actual: theme.ink, opt: theme.muted, pess: theme.muted, scope: theme.subtle };
    } else if (config.colorful) {
      col = { ideal: C.purple, actual: C.red, opt: C.teal, pess: C.orange, scope: C.blue };
    } else {
      col = { ideal: dark ? '#E7E3DC' : C.ink, actual: C.red, opt: C.green, pess: C.amber, scope: C.blue };
    }

    const isUp = config.type === 'burnup';
    const W = 560, H = compact ? 188 : 300;
    const padL = 38, padR = 16, padT = 16, padB = 26;
    const plotL = padL, plotT = padT, plotW = W - padL - padR, plotH = H - padT - padB;
    const x = (day) => plotL + (day / D.SPRINT_DAYS) * plotW;
    const y = (val) => plotT + (1 - val / YMAX) * plotH;
    const baseY = y(0);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', class: 'vk-svg' });

    // ---- gridlines + y labels ----
    TICKS.forEach(t => {
      svg.appendChild(el('line', { x1: plotL, x2: plotL + plotW, y1: y(t), y2: y(t), stroke: theme.grid, 'stroke-width': 1, 'stroke-dasharray': t === 0 ? '0' : '3 3', opacity: t === 0 ? 1 : 0.55 }));
      if (!compact) {
        const lbl = el('text', { x: plotL - 8, y: y(t) + 3.5, 'text-anchor': 'end', class: 'vk-axis', fill: theme.subtle });
        lbl.textContent = t; svg.appendChild(lbl);
      }
    });
    // ---- x labels ----
    if (!compact) {
      for (let dlt = 0; dlt <= D.SPRINT_DAYS; dlt++) {
        const lbl = el('text', { x: x(dlt), y: H - 8, 'text-anchor': 'middle', class: 'vk-axis', fill: theme.subtle });
        lbl.textContent = dlt === 0 ? 'S' : dlt; svg.appendChild(lbl);
      }
    }

    // ---- scope-change shaded "after" region (subtle) ----
    if (D.scopeOn && config.scopeMarker) {
      svg.appendChild(el('rect', { x: x(D.SCOPE_DAY), y: plotT, width: plotW - (x(D.SCOPE_DAY) - plotL), height: plotH, fill: dark ? 'rgba(255,255,255,0.03)' : 'rgba(26,26,26,0.025)' }));
    }

    // ---- daily burn bars (combo variant) ----
    if (config.bars) {
      const bw = plotW / D.SPRINT_DAYS * 0.46;
      for (let dlt = 1; dlt <= D.TODAY; dlt++) {
        const h = (D.accepted[dlt] / YMAX) * plotH;
        svg.appendChild(el('rect', { x: x(dlt) - bw / 2, y: baseY - h, width: bw, height: h, rx: 2, fill: dark ? 'rgba(229,57,43,0.22)' : 'rgba(229,57,43,0.14)' }));
      }
    }

    // ---- forecast cone (optimistic <-> pessimistic band) ----
    const showOpt = f.optimistic, showPess = f.pessimistic;
    if (config.cone && showOpt && showPess) {
      const top = isUp ? D.optUp : D.pessDown;     // upper boundary in screen terms
      const bot = isUp ? D.pessUp : D.optDown;
      const poly = top.map(p => `${x(p.day).toFixed(1)},${y(p.val).toFixed(1)}`)
        .concat(bot.slice().reverse().map(p => `${x(p.day).toFixed(1)},${y(p.val).toFixed(1)}`)).join(' ');
      svg.appendChild(el('polygon', { points: poly, fill: dark ? 'rgba(244,242,238,0.06)' : 'rgba(26,26,26,0.05)', stroke: 'none' }));
    }

    // ---- areas under the actual line ----
    const actualPts = isUp ? ptsFrom(D.completed) : ptsFrom(D.remaining);
    if (config.area && f.actual) {
      const fill = config.colorful ? 'rgba(124,92,252,0.10)' : (config.mono ? (dark ? 'rgba(244,242,238,0.08)' : 'rgba(26,26,26,0.06)') : C.redSoft);
      if (config.areaGradient) {
        const gid = 'g' + Math.random().toString(36).slice(2, 8);
        const defs = el('defs', {});
        const lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(el('stop', { offset: '0%', 'stop-color': col.actual, 'stop-opacity': 0.26 }));
        lg.appendChild(el('stop', { offset: '100%', 'stop-color': col.actual, 'stop-opacity': 0.02 }));
        defs.appendChild(lg); svg.appendChild(defs);
        svg.appendChild(el('path', { d: areaPath(actualPts, x, y, baseY, config.smooth), fill: `url(#${gid})` }));
      } else {
        svg.appendChild(el('path', { d: areaPath(actualPts, x, y, baseY, config.smooth), fill }));
      }
    }
    // burnup gap-to-scope fill (remaining work highlighted)
    if (isUp && config.gapFill && f.actual && f.scope) {
      const scopePts = D.scope.map((v, d) => ({ day: d, val: v })).slice(0, D.TODAY + 1);
      const gap = scopePts.map(p => `${x(p.day).toFixed(1)},${y(p.val).toFixed(1)}`)
        .concat(ptsFrom(D.completed).slice().reverse().map(p => `${x(p.day).toFixed(1)},${y(p.val).toFixed(1)}`)).join(' ');
      svg.appendChild(el('polygon', { points: gap, fill: dark ? 'rgba(183,121,31,0.16)' : 'rgba(183,121,31,0.12)' }));
    }

    // ---- line helper ----
    function drawLine(pts, color, opts) {
      opts = opts || {};
      const p = el('path', { d: linePath(pts, x, y, opts.smooth ?? config.smooth), fill: 'none', stroke: color, 'stroke-width': opts.w || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      if (opts.dash) p.setAttribute('stroke-dasharray', opts.dash);
      if (opts.opacity) p.setAttribute('opacity', opts.opacity);
      svg.appendChild(p);
    }
    function stepPts(arr) { // square-step version of a day-indexed array
      const out = []; let prev = null;
      arr.forEach((v, d) => { if (v == null) { out.push({ day: d, val: null }); prev = null; return; } if (prev != null) out.push({ day: d, val: prev }); out.push({ day: d, val: v }); prev = v; });
      return out;
    }

    // ---- scope reference line ----
    if (f.scope) {
      const scopeArr = D.scope.slice();
      if (isUp) {
        drawLine(stepPts(scopeArr), col.scope, { w: 1.5, dash: config.mono ? '2 4' : '5 4', opacity: 0.9 });
      } else if (D.scopeOn) {
        // burndown: faint total-committed reference at top
        drawLine(stepPts(scopeArr), col.scope, { w: 1.25, dash: '2 5', opacity: 0.5 });
      }
    }

    // ---- ideal / optimum guideline ----
    if (f.ideal) {
      if (config.scopeMarker && D.scopeOn) {
        drawLine(D.idealOriginal, theme.subtle, { w: 1.25, dash: '2 4', opacity: 0.4, smooth: false });
      }
      drawLine(isUp ? D.idealUpPts : D.idealPts, col.ideal, { w: 1.75, dash: '6 5', opacity: dark ? 0.85 : 0.7, smooth: false });
    }

    // ---- forecast lines ----
    if (showOpt) drawLine(isUp ? D.optUp : D.optDown, col.opt, { w: 1.75, dash: '1 5', opacity: 0.95 });
    if (showPess) drawLine(isUp ? D.pessUp : D.pessDown, col.pess, { w: 1.75, dash: '1 5', opacity: 0.95 });

    // ---- actual (the hero series) ----
    if (f.actual) {
      drawLine(config.stepped ? stepPts(isUp ? D.completed : D.remaining) : actualPts, col.actual, { w: compact ? 2 : 2.6 });
      if (config.markers) {
        actualPts.forEach(p => { if (p.val != null) svg.appendChild(el('circle', { cx: x(p.day), cy: y(p.val), r: 3, fill: theme.card, stroke: col.actual, 'stroke-width': 2 })); });
      }
    }

    // ---- scope-change marker pin ----
    if (config.scopeMarker && D.scopeOn) {
      svg.appendChild(el('line', { x1: x(D.SCOPE_DAY), x2: x(D.SCOPE_DAY), y1: plotT, y2: baseY, stroke: col.scope, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.6 }));
      const pin = el('g', {});
      pin.appendChild(el('circle', { cx: x(D.SCOPE_DAY), cy: plotT + 8, r: 8, fill: col.scope }));
      const t = el('text', { x: x(D.SCOPE_DAY), y: plotT + 11.5, 'text-anchor': 'middle', fill: '#fff', class: 'vk-pin' });
      t.textContent = '+12'; pin.appendChild(t); svg.appendChild(pin);
    }

    // ---- today line ----
    if (config.todayLine !== false) {
      svg.appendChild(el('line', { x1: x(D.TODAY), x2: x(D.TODAY), y1: plotT, y2: baseY, stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.55 }));
      if (!compact) {
        const tl = el('text', { x: x(D.TODAY), y: plotT - 5, 'text-anchor': 'middle', class: 'vk-axis', fill: theme.muted });
        tl.textContent = 'TODAY'; svg.appendChild(tl);
      }
    }

    // ---- hover overlay ----
    const guide = el('line', { x1: 0, x2: 0, y1: plotT, y2: baseY, stroke: theme.ink, 'stroke-width': 1, opacity: 0 });
    svg.appendChild(guide);
    const hoverDots = el('g', { opacity: 0 });
    svg.appendChild(hoverDots);
    const overlay = el('rect', { x: plotL, y: plotT, width: plotW, height: plotH, fill: 'transparent', style: 'cursor:crosshair' });
    svg.appendChild(overlay);

    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(svg);
    const tip = document.createElement('div');
    tip.className = 'vk-tip';
    container.appendChild(tip);

    function ptsFrom(arr) { return arr.map((v, d) => ({ day: d, val: v })); }

    const rows = (day) => {
      const r = [];
      const L = D.lookup;
      if (f.actual) r.push([isUp ? 'Completed' : 'Remaining', col.actual, isUp ? D.completed[day] : D.remaining[day]]);
      if (f.ideal) r.push(['Ideal', col.ideal, isUp ? L.idealUp[day] : L.ideal[day]]);
      if (f.optimistic) r.push(['Optimistic', col.opt, isUp ? L.optUp[day] : L.optDown[day]]);
      if (f.pessimistic) r.push(['Pessimistic', col.pess, isUp ? L.pessUp[day] : L.pessDown[day]]);
      if (f.scope) r.push(['Scope', col.scope, L.scope[day]]);
      return r.filter(x => x[2] != null);
    };

    overlay.addEventListener('pointermove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) / rect.width * W;
      let day = Math.round((sx - plotL) / plotW * D.SPRINT_DAYS);
      day = Math.max(0, Math.min(D.SPRINT_DAYS, day));
      const rs = rows(day);
      guide.setAttribute('x1', x(day)); guide.setAttribute('x2', x(day)); guide.setAttribute('opacity', 0.25);
      while (hoverDots.firstChild) hoverDots.removeChild(hoverDots.firstChild);
      rs.forEach(([, c, v]) => hoverDots.appendChild(el('circle', { cx: x(day), cy: y(v), r: 3.5, fill: theme.card, stroke: c, 'stroke-width': 2 })));
      hoverDots.setAttribute('opacity', 1);
      tip.innerHTML = `<div class="vk-tip-day">${day === 0 ? 'Sprint start' : 'Day ' + day}${day === D.TODAY ? ' \u00b7 today' : ''}</div>` +
        rs.map(([n, c, v]) => `<div class="vk-tip-row"><span class="vk-dot" style="background:${c}"></span><span class="vk-tip-n">${n}</span><span class="vk-tip-v">${(+v).toFixed(v % 1 ? 1 : 0)}</span></div>`).join('');
      tip.style.opacity = 1;
      const px = x(day) / W * rect.width;
      tip.style.left = Math.min(rect.width - 132, Math.max(4, px + 10)) + 'px';
      tip.style.top = '10px';
    });
    overlay.addEventListener('pointerleave', () => {
      guide.setAttribute('opacity', 0); hoverDots.setAttribute('opacity', 0); tip.style.opacity = 0;
    });
  }

  function ptsFromGlobal(arr) { return arr.map((v, d) => ({ day: d, val: v })); }
  // expose ptsFrom for module-internal closures
  function ptsFrom(arr) { return arr.map((v, d) => ({ day: d, val: v })); }

  window.ChartKit = { create };
})();
