// ──────────────────────────────────────────────────────────────────────────────
//  app/market-intelligence/projects/ProbabilitySparkline.tsx
//  Phase MI-6 PR3 — Inline SVG probability-over-time sparkline.
//
//  Pure SVG; no chart library. ~50 lines. Renders a line from oldest to
//  newest probability snapshot. Constraint from MI-6 PR3 spec: no fancy
//  graph visualizations, no heavy chart libraries.
// ──────────────────────────────────────────────────────────────────────────────

interface Point {
  computedAt: Date;
  probability: number;
}

export function ProbabilitySparkline({
  points,
  width = 240,
  height = 36,
}: {
  points: Point[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <div
        className="font-mono text-[10px] opacity-50 italic"
        style={{ width, height }}
      >
        no probability history
      </div>
    );
  }

  const sorted = [...points].sort((a, b) => a.computedAt.getTime() - b.computedAt.getTime());
  const minT = sorted[0].computedAt.getTime();
  const maxT = sorted[sorted.length - 1].computedAt.getTime();
  const tSpan = Math.max(1, maxT - minT);

  const padX = 4;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const polyline = sorted
    .map((p) => {
      const x = padX + (innerW * (p.computedAt.getTime() - minT)) / tSpan;
      // Probability inverted because SVG y grows downward; clamp to [0,1].
      const pr = Math.max(0, Math.min(1, p.probability));
      const y = padY + innerH * (1 - pr);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = sorted[sorted.length - 1];
  const lastX = padX + (innerW * (last.computedAt.getTime() - minT)) / tSpan;
  const lastY = padY + innerH * (1 - Math.max(0, Math.min(1, last.probability)));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {/* Faint horizontal grid lines at 0.25, 0.5, 0.75 */}
      {[0.25, 0.5, 0.75].map((g) => {
        const gy = padY + innerH * (1 - g);
        return (
          <line
            key={g}
            x1={padX}
            x2={width - padX}
            y1={gy}
            y2={gy}
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeWidth={0.5}
          />
        );
      })}
      <polyline fill="none" stroke="currentColor" strokeOpacity="0.75" strokeWidth={1.3} points={polyline} />
      <circle cx={lastX} cy={lastY} r={2.2} fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}
