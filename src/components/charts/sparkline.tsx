// src/components/charts/sparkline.tsx
//
// A stat tile's trend line. Decorative — the tile's value and delta already
// say what it shows — so it is aria-hidden and needs no client JS.

import { useId } from "react";
import { areaPath, linear, linePath, type Pt } from "@/lib/charts/geometry";

export function Sparkline({
  values,
  color = "var(--accent)",
  width = 96,
  height = 32,
  onHero = false,
  fluid = false,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  /** Drawn in white on the hero gradient. */
  onHero?: boolean;
  /** Stretch to the container's width (hero use); strokes stay 2px, no end dot. */
  fluid?: boolean;
}) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = linear([0, values.length - 1], [3, width - 5]);
  const y = linear([lo, hi === lo ? lo + 1 : hi], [height - 3, 4]);
  const pts = values.map((v, i) => [x(i), y(v)] as Pt);
  const last = pts.at(-1)!;
  const stroke = onHero ? "var(--on-hero)" : color;
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      aria-hidden
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={onHero ? 0.35 : 0.24} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath(pts, height)} fill={`url(#${gid})`} />
      <path
        d={linePath(pts)}
        fill="none"
        stroke={stroke}
        strokeWidth={onHero ? 2.5 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="chart-draw"
      />
      {fluid ? null : <circle cx={last[0]} cy={last[1]} r={3.5} fill={stroke} stroke={onHero ? "transparent" : "var(--surface-1)"} strokeWidth={2} />}
    </svg>
  );
}
