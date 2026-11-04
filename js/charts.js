// Gráfico de línea en SVG, sin librerías. Un solo trazo por gráfico.
// points: [{ label, value, n }]  — value null = semana sin datos (corta la línea).

export function lineChart({ points, fmt, min, max, ref, labelAll = false }) {
  const vals = points.map(p => p.value).filter(v => v != null && isFinite(v));
  if (!vals.length) return '<p class="muted small">Sin datos en este período.</p>';

  const W = 340, H = 168, padL = 40, padR = 14, padT = 22, padB = 26;
  let lo = min ?? Math.min(...vals);
  let hi = max ?? Math.max(...vals);
  if (ref != null) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
  if (min == null || max == null) {
    const span = (hi - lo) || Math.abs(hi) || 1;
    if (min == null) lo -= span * 0.12;
    if (max == null) hi += span * 0.12;
  }
  const x = i => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (points.length - 1));
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  // grilla y eje Y
  const mid = ref != null && ref > lo && ref < hi ? ref : (lo + hi) / 2;
  for (const t of [lo, mid, hi]) {
    s += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    s += `<text x="${padL - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${fmt(t)}</text>`;
  }
  if (ref != null) s += `<line x1="${padL}" x2="${W - padR}" y1="${y(ref)}" y2="${y(ref)}" class="ref"/>`;
  // eje X
  const step = Math.ceil(points.length / 6);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) {
      s += `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="middle">${p.label}</text>`;
    }
  });
  // línea (se corta en semanas vacías)
  let d = '', pen = false;
  points.forEach((p, i) => {
    if (p.value == null || !isFinite(p.value)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  s += `<path d="${d}" class="line"/>`;
  // puntos: huecos si la semana tiene menos de 5 games
  const lastIdx = points.map(p => p.value != null && isFinite(p.value)).lastIndexOf(true);
  points.forEach((p, i) => {
    if (p.value == null || !isFinite(p.value)) return;
    const cx = x(i), cy = y(p.value);
    const tip = `Semana ${p.label}: ${fmt(p.value)} (${p.n} game${p.n === 1 ? '' : 's'})`;
    s += `<circle cx="${cx}" cy="${cy}" r="4.5" class="${p.n < 5 ? 'pt low' : 'pt'}"/>`;
    if (labelAll || i === lastIdx) {
      s += `<text x="${cx}" y="${cy - 12}" class="val" text-anchor="middle">${fmt(p.value)}</text>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="16" class="hit" data-tip="${tip}"/>`;
  });
  return s + '</svg>';
}
