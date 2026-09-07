export const CAT_COLORS = [
  "var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)",
  "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)",
];
export const catColor = (i: number) => CAT_COLORS[i % CAT_COLORS.length];

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  size = 120,
  stroke = 16,
  centerValue,
  centerSub,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  centerValue?: string;
  centerSub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }} role="img" aria-label="donut chart">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
      {segments.map((seg) => {
        const frac = seg.value / total;
        const len = frac * c;
        const el = (
          <circle
            key={seg.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          >
            <title>{seg.label}: {seg.value}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      {centerValue != null && (
        <>
          <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontFamily="Fraunces, serif" fontWeight={600} fontSize={20} fill="var(--ink-900)">
            {centerValue}
          </text>
          <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize={10} fill="var(--ink-400)">
            {centerSub ?? ""}
          </text>
        </>
      )}
    </svg>
  );
}

export interface BarRow {
  label: string;
  value: number;
  color?: string;
}

export function Sparkline({ points, w = 220, h = 56 }: { points: { label: string; value: number }[]; w?: number; h?: number }) {
  const pad = 4;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max === min ? 1 : max - min;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [pad + i * step, h - pad - ((p.value - min) / range) * (h - pad * 2)]);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: w, height: h }} role="img" aria-label="trend sparkline">
      <path d={area} fill="var(--brass-100)" opacity={0.6} />
      <path d={path} fill="none" stroke="var(--brass-500)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3 : 2} fill="var(--brass-600)" />
      ))}
    </svg>
  );
}

export function BarChartH({ rows, fmt }: { rows: BarRow[]; fmt?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const w = Math.max((r.value / max) * 100, 3);
        return (
          <div key={r.label} className="flex flex-col gap-1">
            <div className="flex justify-between text-[12px]">
              <span className="font-semibold" style={{ color: "var(--ink-700)" }}>{r.label}</span>
              <span className="tabular-nums" style={{ color: "var(--ink-400)" }}>{fmt ? fmt(r.value) : r.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
              <div className="h-full rounded-full" style={{ width: `${w}%`, background: r.color ?? "var(--brass-500)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
