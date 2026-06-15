/* ============================================================
   Hand-built SVG charts — styled to the semantic palette.
   Every function returns an SVG string.
   ============================================================ */
window.Charts = (function () {
  const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');

  function sparkline(data, color, w = 120, h = 34) {
    const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
    const pts = data.map((v, i) => [ (i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2 ]);
    const area = path(pts) + ` L${w} ${h} L0 ${h} Z`;
    const id = 'sg' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${path(pts)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // dual-series area (revenue + visits), with axes + gridlines
  function area2(a, b, colorA, colorB, w = 720, h = 240) {
    const pad = { l: 8, r: 8, t: 12, b: 22 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const norm = (data) => { const mx = Math.max(...data) || 1; return data.map((v, i) => [ pad.l + (i / (data.length - 1)) * iw, pad.t + ih - (v / mx) * ih ]); };
    const pa = norm(a), pb = norm(b);
    const grid = [0, .25, .5, .75, 1].map(f => { const y = pad.t + ih * f; return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="hsl(214 32% 91%)" stroke-width="1"/>`; }).join('');
    const aArea = path(pa) + ` L${pa[pa.length-1][0]} ${pad.t+ih} L${pa[0][0]} ${pad.t+ih} Z`;
    const labels = ['30d ago','20d','10d','today'].map((t,i)=>`<text x="${pad.l + (i/3)*iw}" y="${h-5}" fill="hsl(215 16% 47%)" font-size="10" text-anchor="${i===0?'start':i===3?'end':'middle'}">${t}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
      <defs><linearGradient id="ar" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${colorA}" stop-opacity=".22"/><stop offset="100%" stop-color="${colorA}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${aArea}" fill="url(#ar)"/>
      <path d="${path(pb)}" fill="none" stroke="${colorB}" stroke-width="2" stroke-dasharray="4 4" opacity=".9"/>
      <path d="${path(pa)}" fill="none" stroke="${colorA}" stroke-width="2.5" stroke-linejoin="round"/>
      ${labels}
    </svg>`;
  }

  function bars(data, color, w = 720, h = 220) {
    const pad = { l: 8, r: 8, t: 12, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const mx = Math.max(...data.map(d => d.v)) || 1;
    const bw = iw / data.length;
    const rects = data.map((d, i) => {
      const bh = (d.v / mx) * ih, x = pad.l + i * bw + bw * .18, y = pad.t + ih - bh;
      const isLast = i === data.length - 1;
      return `<rect x="${x}" y="${y}" width="${bw * .64}" height="${bh}" rx="5" fill="${color}" opacity="${isLast ? 1 : .35}"/>
        <text x="${x + bw*.32}" y="${h - 9}" fill="hsl(215 16% 47%)" font-size="11" text-anchor="middle">${d.m}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${rects}</svg>`;
  }

  function hbars(data, color) {
    const mx = Math.max(...data.map(d => d.v)) || 1;
    return `<div class="space-y-2.5">` + data.map(d => `
      <div class="flex items-center gap-3 text-[13px]">
        <span class="w-24 shrink-0 text-muted-foreground font-mono truncate">${d.p}</span>
        <div class="flex-1 h-6 rounded-md bg-muted overflow-hidden">
          <div class="h-full rounded-md" style="width:${(d.v/mx)*100}%;background:${color}"></div>
        </div>
        <span class="w-8 text-right font-semibold tabular-nums">${d.v}</span>
      </div>`).join('') + `</div>`;
  }

  function donut(data, size = 150) {
    const total = data.reduce((s, d) => s + d.v, 0) || 1;
    const r = 58, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
    let off = 0;
    const rings = data.map(d => {
      const frac = d.v / total, dash = frac * c;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.c.startsWith('var')?`hsl(${getVar(d.c)})`:d.c}" stroke-width="18"
        stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
      off += dash; return seg;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      ${rings}
      <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="22" font-weight="700" fill="hsl(222 47% 11%)">${total}</text>
      <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10" fill="hsl(215 16% 47%)">visits</text>
    </svg>`;
  }

  function radial(pct, label, color, size = 150) {
    const r = 58, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
    const dash = (pct / 100) * c;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="hsl(210 40% 94%)" stroke-width="14"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="14"
        stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
      <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="24" font-weight="700" fill="hsl(222 47% 11%)">${pct}%</text>
      <text x="${cx}" y="${cy+17}" text-anchor="middle" font-size="10" fill="hsl(215 16% 47%)">${label}</text>
    </svg>`;
  }

  // small helper so donut can read CSS vars
  function getVar(v) {
    const name = v.replace('var(', '').replace(')', '').trim();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  return { sparkline, area2, bars, hbars, donut, radial };
})();
