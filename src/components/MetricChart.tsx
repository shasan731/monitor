"use client";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Point {
  t: number; // unix ms
  v: number; // 0..100
}

interface Props {
  title: string;
  icon: React.ReactNode;
  points: Point[]; // newest-first or oldest-first — we sort defensively
  unit?: string;
  height?: number;
  threshold?: { warn: number; crit: number };
  /** Maximum y-axis value. Defaults to 100 (for percentages). */
  max?: number;
  rightLabel?: React.ReactNode;
}

/** Larger SVG line chart: grid, axis labels, latest value, no deps. */
export function MetricChart({
  title,
  icon,
  points,
  unit = "%",
  height = 140,
  threshold = { warn: 65, crit: 85 },
  max = 100,
  rightLabel,
}: Props) {
  const sorted = useMemo(
    () => [...points].sort((a, b) => a.t - b.t),
    [points]
  );

  const latest = sorted[sorted.length - 1];
  const color =
    !latest ? "text-muted-foreground" :
    latest.v > threshold.crit ? "text-destructive" :
    latest.v > threshold.warn ? "text-warning" : "text-success";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            {icon}
            {title}
          </CardTitle>
          {rightLabel ?? (
            <span className={`text-2xl font-mono tabular-nums ${color}`}>
              {latest ? `${latest.v.toFixed(0)}${unit}` : "—"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Chart points={sorted} height={height} unit={unit} max={max} />
      </CardContent>
    </Card>
  );
}

function Chart({ points, height, unit, max }: { points: Point[]; height: number; unit: string; max: number }) {
  // Sample to ~one point per minute (cap series length) so narrow viewports
  // don't try to draw 600+ data points along a 600px wide viewBox.
  const sampled = sampleSeries(points, 360);
  const W = 600;
  const H = height;
  const PAD_L = 32;
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = 20;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  if (sampled.length === 0) {
    return <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>;
  }

  const t0 = sampled[0].t;
  const t1 = sampled[sampled.length - 1].t;
  const span = Math.max(t1 - t0, 1);

  const x = (t: number) => PAD_L + ((t - t0) / span) * innerW;
  const y = (v: number) => PAD_T + (1 - Math.max(0, Math.min(max, v)) / max) * innerH;

  const linePath = sampled
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `${linePath} L${x(t1).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${x(t0).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;

  const fmtTime = (t: number) => {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const last = sampled[sampled.length - 1];
  const min = sampled.reduce((a, p) => Math.min(a, p.v), Infinity);
  const peak = sampled.reduce((a, p) => Math.max(a, p.v), -Infinity);
  const ariaLabel =
    `Time series, ${sampled.length} samples, latest ${last.v.toFixed(0)}${unit}, ` +
    `range ${min.toFixed(0)}–${peak.toFixed(0)}${unit}.`;

  return (
    // Default preserveAspectRatio (xMidYMid meet) keeps the line proportional;
    // pin a height via the SVG attribute so layout still flows.
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="block"
      role="img"
      aria-label={ariaLabel}
    >
      {/* horizontal grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const g = f * max;
        return (
          <g key={f}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(g)}
              y2={y(g)}
              className="stroke-border"
              strokeDasharray={f === 0 || f === 1 ? "" : "2 3"}
              strokeWidth={0.5}
            />
            <text
              x={PAD_L - 4}
              y={y(g) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px] font-mono"
            >
              {Math.round(g)}{unit}
            </text>
          </g>
        );
      })}

      {/* time axis labels */}
      <text x={PAD_L} y={H - 6} className="fill-muted-foreground text-[9px] font-mono">{fmtTime(t0)}</text>
      <text x={W - PAD_R} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[9px] font-mono">{fmtTime(t1)}</text>

      {/* data */}
      <path d={areaPath} className="fill-current" fillOpacity={0.12} />
      <path d={linePath} className="stroke-current" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* latest point */}
      {sampled.length > 0 && (
        <circle cx={x(sampled[sampled.length - 1].t)} cy={y(sampled[sampled.length - 1].v)} r={2.5} className="fill-current" />
      )}
    </svg>
  );
}

// Even-stride sample so dense series don't render hundreds of overlapping
// segments. Always preserves the first and last point.
function sampleSeries(points: Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints) return points;
  const stride = points.length / maxPoints;
  const out: Point[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(points.length - 1, Math.floor(i * stride));
    out.push(points[idx]);
  }
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}
