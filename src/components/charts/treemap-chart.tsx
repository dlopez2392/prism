"use client";

// src/components/charts/treemap-chart.tsx
//
// Holdings as tiles sized by value, coloured by asset class (identity). A
// label goes inside a tile only when it fits with room to spare; otherwise
// the tile's hover/focus tooltip carries it and the table view has it too.
// In-tile labels sit on a small surface chip: no series hue in either mode
// gives white OR ink text 4.5:1 across all eight slots, a chip always does.

import { useMemo, useState } from "react";
import { squarify } from "@/lib/charts/geometry";
import { ChartPlaceholder, ChartTooltip, fmt, useWidth } from "./core";

export type Tile = {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  color: string;
  group: string;
};

export function TreemapChart({ tiles, height = 280, ariaLabel }: { tiles: Tile[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const total = tiles.reduce((s, t) => s + t.value, 0);
  const rects = useMemo(() => (width ? squarify(tiles.map((t) => t.value), { x: 0, y: 0, w: width, h: height }) : null), [tiles, width, height]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {!rects ? (
        <ChartPlaceholder height={height} />
      ) : (
        <>
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block" onPointerLeave={() => setHover(null)}>
            {tiles.map((t, i) => {
              const r = rects[i]!;
              // A 2px surface gap between tiles: inset each by 1px.
              const x = r.x + 1;
              const y = r.y + 1;
              const w = Math.max(0, r.w - 2);
              const h = Math.max(0, r.h - 2);
              // Measure before placing: a chip that would overflow its tile is
              // dropped (the tooltip and table still carry the value).
              const valueText = `${fmt("compact", t.value)} · ${Math.round((t.value / total) * 100)}%`;
              const labelW = t.label.length * 8 + 14;
              const valueW = valueText.length * 6.4 + 14;
              const fitsValue = Math.max(labelW, valueW) <= w - 12 && h >= 56;
              const fits = fitsValue || (labelW <= w - 12 && h >= 34);
              const chipW = fitsValue ? Math.max(labelW, valueW) : labelW;
              return (
                <g
                  key={t.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${t.label}, ${t.sublabel}: ${fmt("money0", t.value)}`}
                  className="mark cursor-pointer outline-none"
                  opacity={hover !== null && hover !== i ? 0.55 : 1}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <rect x={x} y={y} width={w} height={h} rx={Math.min(8, w / 4, h / 4)} fill={t.color} />
                  {fits ? (
                    <g>
                      <rect x={x + 6} y={y + 6} width={chipW} height={fitsValue ? 38 : 22} rx={6} fill="var(--surface-1)" opacity={0.92} />
                      <text x={x + 12} y={y + 21} className="fill-[var(--ink-1)] text-[12px] font-bold">
                        {t.label}
                      </text>
                      {fitsValue ? (
                        <text x={x + 12} y={y + 36} className="num fill-[var(--ink-2)] text-[11px] font-medium">
                          {valueText}
                        </text>
                      ) : null}
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {hover !== null ? (
            <ChartTooltip
              x={rects[hover]!.x + rects[hover]!.w / 2}
              y={Math.max(0, rects[hover]!.y + 8)}
              width={width}
              title={`${tiles[hover]!.label} · ${tiles[hover]!.group}`}
              rows={[
                { color: tiles[hover]!.color, key: "dot", label: tiles[hover]!.sublabel, value: fmt("money0", tiles[hover]!.value) },
                { label: "of your portfolio", value: `${Math.round((tiles[hover]!.value / total) * 100)}%` },
              ]}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
