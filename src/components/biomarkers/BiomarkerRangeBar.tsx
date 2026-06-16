/**
 * BiomarkerRangeBar - compact SVG showing a biomarker value's position
 * within its reference range.
 *
 * The bar's displayed extent is 20% wider than [min, max] on each side so
 * normal-range values visibly sit within a context window. Values beyond
 * 2× the range width in either direction clip to the edge and render a
 * ">" / "<" arrow instead of a dot.
 */

interface BiomarkerRangeBarProps {
  value: number;
  min: number;
  max: number;
  /** Optional override height in px (default 3px track, 6px marker). */
  className?: string;
}

const TRACK_HEIGHT = 3;
const MARKER_RADIUS = 3;
// Vertical room for the marker dot on either side of the track.
const SVG_HEIGHT = MARKER_RADIUS * 2 + 4;
const VIEWBOX_WIDTH = 100;

export default function BiomarkerRangeBar({ value, min, max, className }: BiomarkerRangeBarProps) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const rangeWidth = max - min;
  const padding = rangeWidth * 0.2;
  const displayMin = min - padding;
  const displayMax = max + padding;
  const displaySpan = displayMax - displayMin;

  const toX = (raw: number) => ((raw - displayMin) / displaySpan) * VIEWBOX_WIDTH;

  const fillStartX = toX(min);
  const fillEndX = toX(max);

  // Clip marker to edges if value is >2× the range width outside bounds.
  const clipOutside = rangeWidth * 2;
  let markerX = toX(value);
  let clipDirection: 'left' | 'right' | null = null;
  if (value < displayMin - clipOutside) {
    markerX = MARKER_RADIUS;
    clipDirection = 'left';
  } else if (value > displayMax + clipOutside) {
    markerX = VIEWBOX_WIDTH - MARKER_RADIUS;
    clipDirection = 'right';
  } else {
    markerX = Math.max(MARKER_RADIUS, Math.min(VIEWBOX_WIDTH - MARKER_RADIUS, markerX));
  }

  const isInRange = value >= min && value <= max;
  const markerColor = isInRange ? 'var(--wellness-500, #10b981)' : 'var(--red-500, #ef4444)';
  const trackY = SVG_HEIGHT / 2 - TRACK_HEIGHT / 2;
  const markerY = SVG_HEIGHT / 2;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${SVG_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height={SVG_HEIGHT}
      className={className}
      role="img"
      aria-label={
        isInRange
          ? `Value ${value}, within the reference range ${min} to ${max}`
          : `Value ${value}, outside the reference range ${min} to ${max}`
      }
    >
      {/* Track (full context window) */}
      <rect
        x={0}
        y={trackY}
        width={VIEWBOX_WIDTH}
        height={TRACK_HEIGHT}
        rx={TRACK_HEIGHT / 2}
        className="fill-slate-200 dark:fill-slate-700"
      />
      {/* In-range fill */}
      <rect
        x={fillStartX}
        y={trackY}
        width={Math.max(0, fillEndX - fillStartX)}
        height={TRACK_HEIGHT}
        rx={TRACK_HEIGHT / 2}
        className="fill-wellness-500/70 dark:fill-wellness-400/70"
      />
      {/* Marker */}
      {clipDirection === null ? (
        <circle
          cx={markerX}
          cy={markerY}
          r={MARKER_RADIUS}
          fill={markerColor}
          stroke="var(--card-bg, white)"
          strokeWidth={1}
        />
      ) : (
        <g transform={`translate(${markerX}, ${markerY})`}>
          <polygon
            points={clipDirection === 'right' ? '-3,-3 3,0 -3,3' : '3,-3 -3,0 3,3'}
            fill={markerColor}
          />
        </g>
      )}
    </svg>
  );
}
