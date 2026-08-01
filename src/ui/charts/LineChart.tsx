import { useMemo } from 'react';

export interface Series {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  title: string;
  series: Series[];
  height?: number;
  /** Wymuszone minimum osi Y (np. 0 dla liczebności). */
  yMin?: number;
  format?: (v: number) => string;
}

const WIDTH = 320;

/**
 * Minimalny wykres liniowy w SVG.
 *
 * Świadomie bez biblioteki wykresów: seria ma kilkaset punktów,
 * odświeżamy ją 6 razy na sekundę, a każda zewnętrzna zależność
 * kosztowałaby więcej niż te 40 linijek.
 */
export function LineChart({ title, series, height = 84, yMin, format }: Props) {
  const { paths, min, max } = useMemo(() => {
    let lo = yMin ?? Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) lo = 0;
    if (!isFinite(hi)) hi = 1;
    if (hi - lo < 1e-9) hi = lo + 1;

    const paths = series.map((s) => {
      const n = s.values.length;
      if (n === 0) return { ...s, d: '' };
      const step = n > 1 ? WIDTH / (n - 1) : 0;
      let d = '';
      for (let i = 0; i < n; i++) {
        const x = i * step;
        const y = height - ((s.values[i] - lo) / (hi - lo)) * height;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      return { ...s, d };
    });

    return { paths, min: lo, max: hi };
  }, [series, height, yMin]);

  const fmt = format ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-range">
          {fmt(min)} – {fmt(max)}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className="chart-svg">
        <line x1="0" y1={height - 0.5} x2={WIDTH} y2={height - 0.5} stroke="#262e3d" strokeWidth="1" />
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill="none" stroke={p.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
