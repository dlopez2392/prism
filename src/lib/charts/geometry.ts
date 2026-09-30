// src/lib/charts/geometry.ts
//
// Chart geometry with no React and no DOM — scales, ticks, curve and mark
// paths, arcs. The components in components/charts only render what these
// return, which keeps the maths unit-testable and the components thin.

export type Pt = [number, number];

/** A linear map from a domain onto a pixel range. */
export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** The smallest "nice" step (1, 2, 2.5, 5 × 10ⁿ) at least as big as `raw`. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/**
 * Clean, round axis ticks spanning [min, max]: 0 / 2,000 / 4,000, never
 * 0 / 1,137 / 2,274 — about `count` intervals. Always includes zero when the
 * data straddles it.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const step = niceStep((max - min) / Math.max(1, count));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Monotone cubic interpolation (Fritsch–Carlson): smooth, but never
 * overshoots — a balance that went 100 → 100 → 90 must not bulge to 103
 * between the first two points just because a spline wanted it to.
 * Returns one "C" segment per interval so callers can split a line into a
 * solid past and a dashed projection without re-fitting.
 */
export function monotoneSegments(pts: Pt[]): string[] {
  const n = pts.length;
  if (n < 2) return [];
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push(dx[i] === 0 ? 0 : (pts[i + 1]![1] - pts[i]![1]) / dx[i]!);
  }
  const t: number[] = new Array(n);
  t[0] = m[0]!;
  t[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i]!;
      t[i + 1] = tau * b * m[i]!;
    }
  }
  const segs: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    segs.push(`C${r1(x0 + h)},${r1(y0 + t[i]! * h)} ${r1(x1 - h)},${r1(y1 - t[i + 1]! * h)} ${r1(x1)},${r1(y1)}`);
  }
  return segs;
}

/**
 * "smooth" for flows and rates; "step" for balances, which do not glide
 * between days — they sit still, then jump when money lands.
 */
export type Curve = "smooth" | "step";

/** Step-after segments: hold the value until the next point, then jump. */
export function stepSegments(pts: Pt[]): string[] {
  const segs: string[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    segs.push(`L${r1(x1)},${r1(y0)} L${r1(x1)},${r1(y1)}`);
  }
  return segs;
}

function segments(pts: Pt[], curve: Curve): string[] {
  return curve === "step" ? stepSegments(pts) : monotoneSegments(pts);
}

/** A line through `pts`, optionally only for intervals [from, to). */
export function linePath(pts: Pt[], from = 0, to = pts.length - 1, curve: Curve = "smooth"): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${r1(pts[0]![0])},${r1(pts[0]![1])}`;
  const segs = segments(pts, curve).slice(from, to);
  const start = pts[from]!;
  return `M${r1(start[0])},${r1(start[1])} ${segs.join(" ")}`;
}

/** The area between a line and a flat baseline. */
export function areaPath(pts: Pt[], baseline: number, curve: Curve = "smooth"): string {
  if (pts.length < 2) return "";
  const first = pts[0]!;
  const last = pts.at(-1)!;
  return `${linePath(pts, 0, pts.length - 1, curve)} L${r1(last[0])},${r1(baseline)} L${r1(first[0])},${r1(baseline)} Z`;
}

/** Step-after vertices, so a step band's lower edge can be walked backwards. */
function stepVertices(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    if (i > 0) out.push([p[0], pts[i - 1]![1]]);
    out.push(p);
  });
  return out;
}

/** The area between two lines (a forecast band). */
export function bandPath(upper: Pt[], lower: Pt[], curve: Curve = "smooth"): string {
  if (upper.length < 2) return "";
  if (curve === "step") {
    const back = stepVertices(lower).reverse();
    return `${linePath(upper, 0, upper.length - 1, "step")} ${back.map(([x, y]) => `L${r1(x)},${r1(y)}`).join(" ")} Z`;
  }
  const back = [...lower].reverse();
  const segsBack = monotoneSegments(back);
  const start = back[0]!;
  return `${linePath(upper)} L${r1(start[0])},${r1(start[1])} ${segsBack.join(" ")} Z`;
}

/**
 * A bar with a 4px rounded data-end and a square foot on the baseline. A
 * negative bar grows DOWN from the baseline and rounds at the bottom.
 */
export function barPath(x: number, y0: number, y1: number, w: number, radius = 4): string {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  if (h < 0.5 || w <= 0) return "";
  const r = Math.min(radius, w / 2, h);
  const up = y1 <= y0; // data end is above the baseline
  if (up) {
    return `M${r1(x)},${r1(top + h)} L${r1(x)},${r1(top + r)} Q${r1(x)},${r1(top)} ${r1(x + r)},${r1(top)} L${r1(x + w - r)},${r1(top)} Q${r1(x + w)},${r1(top)} ${r1(x + w)},${r1(top + r)} L${r1(x + w)},${r1(top + h)} Z`;
  }
  const bottom = top + h;
  return `M${r1(x)},${r1(top)} L${r1(x)},${r1(bottom - r)} Q${r1(x)},${r1(bottom)} ${r1(x + r)},${r1(bottom)} L${r1(x + w - r)},${r1(bottom)} Q${r1(x + w)},${r1(bottom)} ${r1(x + w)},${r1(bottom - r)} L${r1(x + w)},${r1(top)} Z`;
}

/** A plain rectangle path — a stacked segment that is not the data end. */
export function rectPath(x: number, y: number, w: number, h: number): string {
  if (h < 0.5 || w <= 0) return "";
  return `M${r1(x)},${r1(y)} h${r1(w)} v${r1(h)} h${r1(-w)} Z`;
}

/** Polar → cartesian, angle in radians clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, a: number): Pt {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** An annular sector from angle a0 to a1 (radians, clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return [
    `M${r1(x0)},${r1(y0)}`,
    `A${r1(rOuter)},${r1(rOuter)} 0 ${large} 1 ${r1(x1)},${r1(y1)}`,
    `L${r1(x2)},${r1(y2)}`,
    `A${r1(rInner)},${r1(rInner)} 0 ${large} 0 ${r1(x3)},${r1(y3)}`,
    "Z",
  ].join(" ");
}

/** A stroked arc (centre-line) — for rings drawn with round caps. */
export function strokeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a0 + sweep);
  return `M${r1(x0)},${r1(y0)} A${r1(r)},${r1(r)} 0 ${large} 1 ${r1(x1)},${r1(y1)}`;
}

/** Every `step`-th index, always including the last — for thinning labels by parity. */
/**
 * Label positions for points that may sit on top of each other — two lines
 * ending at nearly the same value, say. Each label stays as close to its own
 * point as it can, keeps its order, sits at least `gap` from its neighbours,
 * and stays inside [min, max] (when they fit at all). Returned in input order.
 */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const placed = order.map(([y]) => Math.min(max, Math.max(min, y)));
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap);
  const over = placed.length ? placed.at(-1)! - max : 0;
  if (over > 0) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - gap);
    // Too many to fit: keep the top one in bounds and let the rest overflow down, still apart.
    if (placed[0]! < min) {
      placed[0] = min;
      for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap);
    }
  }
  const out = new Array<number>(ys.length);
  order.forEach(([, i], k) => (out[i] = placed[k]!));
  return out;
}

export function thinIndices(count: number, maxLabels: number): number[] {
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = (count - 1) % step; i < count; i += step) out.push(i);
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays values out as
 * near-square tiles, largest first, so small holdings stay legible.
 */
export function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const order = values.map((v, i) => ({ v: Math.max(0, v), i })).sort((a, b) => b.v - a.v);
  const out: Rect[] = new Array(values.length);
  if (total <= 0) {
    for (let i = 0; i < values.length; i++) out[i] = { x: box.x, y: box.y, w: 0, h: 0 };
    return out;
  }
  const scale = (box.w * box.h) / total;
  const areas = order.map((o) => ({ a: o.v * scale, i: o.i }));
  let { x, y, w, h } = box;
  let row: { a: number; i: number }[] = [];

  const worst = (r: { a: number }[], side: number) => {
    const s = r.reduce((acc, e) => acc + e.a, 0);
    const max = Math.max(...r.map((e) => e.a));
    const min = Math.min(...r.map((e) => e.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layRow = (r: { a: number; i: number }[]) => {
    const s = r.reduce((acc, e) => acc + e.a, 0);
    if (w >= h) {
      const rw = s / h;
      let yy = y;
      for (const e of r) {
        const eh = e.a / rw;
        out[e.i] = { x, y: yy, w: rw, h: eh };
        yy += eh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = s / w;
      let xx = x;
      for (const e of r) {
        const ew = e.a / rh;
        out[e.i] = { x: xx, y, w: ew, h: rh };
        xx += ew;
      }
      y += rh;
      h -= rh;
    }
  };

  for (const e of areas) {
    if (e.a === 0) {
      out[e.i] = { x, y, w: 0, h: 0 };
      continue;
    }
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, e], side) <= worst(row, side)) {
      row.push(e);
    } else {
      layRow(row);
      row = [e];
    }
  }
  if (row.length) layRow(row);
  return out;
}

/**
 * Quantile thresholds for a sequential ramp: `bins` buckets over the non-zero
 * values, so one huge rent day does not wash every other day to the lightest
 * step. Returns the upper edge of each bucket but the last.
 */
export function quantileThresholds(values: number[], bins: number): number[] {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (xs.length === 0) return [];
  const out: number[] = [];
  for (let b = 1; b < bins; b++) out.push(xs[Math.max(0, Math.ceil((b / bins) * xs.length) - 1)]!);
  return out;
}

export function binOf(value: number, thresholds: number[]): number {
  if (value <= 0) return 0;
  let b = 1;
  for (const t of thresholds) if (value > t) b++;
  return b;
}
