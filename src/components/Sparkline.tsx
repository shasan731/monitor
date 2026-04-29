"use client";
import { useMemo } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  /** Force a fixed scale instead of auto-fitting min/max of the data. */
  min?: number;
  max?: number;
  /** Accessible description summarising the series for screen readers. */
  ariaLabel?: string;
}

/** Tiny dependency-free SVG sparkline. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill = "currentColor",
  min,
  max,
  ariaLabel,
}: SparklineProps) {
  const { path, area } = useMemo(() => {
    if (!values.length) return { path: "", area: "" };

    // Auto-scale unless caller pinned a range. Adds ~10% headroom so a
    // perfectly flat line doesn't sit on top/bottom of the box. A truly
    // constant series (min===max) is centred.
    let lo: number;
    let hi: number;
    if (min != null && max != null) {
      lo = min;
      hi = max;
    } else {
      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
      if (dataMin === dataMax) {
        lo = dataMin - 1;
        hi = dataMax + 1;
      } else {
        const pad = (dataMax - dataMin) * 0.1;
        lo = dataMin - pad;
        hi = dataMax + pad;
      }
    }
    const range = hi - lo || 1;

    const step = values.length > 1 ? width / (values.length - 1) : width;
    const scaleY = (v: number) => height - ((v - lo) / range) * height;
    const points = values.map((v, i) => `${i * step},${scaleY(v).toFixed(2)}`);
    const path = "M" + points.join(" L");
    const lastX = (values.length - 1) * step;
    const area = `${path} L${lastX},${height} L0,${height} Z`;
    return { path, area };
  }, [values, width, height, min, max]);

  if (!values.length) {
    return <div className="h-8 text-xs text-muted-foreground">no data</div>;
  }

  const latest = values[values.length - 1];
  const label =
    ariaLabel ?? `Sparkline, latest ${latest.toFixed(0)}, ${values.length} samples`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={label}
    >
      <path d={area} fill={fill} fillOpacity={0.12} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
