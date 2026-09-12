import {
  formatDay,
  formatLift,
  useFirstRain,
  useFirstRainSeries,
} from "../../hooks/useFirstRain";

const W = 600;
const H = 200;
const PAD_X = 8;
const PAD_T = 12;
const PAD_B = 28;

/**
 * Story block: daily crash counts for the two weeks either side of a
 * county's most recent first-rain day, with the dry-month baseline as a
 * dashed line. Two fetches — the summary picks the county's latest water
 * year, then the series for it. Renders nothing until both exist, so a
 * story can carry it before the backend endpoint ships.
 */
export default function FirstRainBlock({ countySlug }: { countySlug: string }) {
  const { data: summary } = useFirstRain();
  const event =
    summary?.counties
      .filter((c) => c.county_slug === countySlug)
      .sort((a, b) => b.water_year - a.water_year)[0] ?? null;
  const { data: series } = useFirstRainSeries(
    event ? countySlug : null,
    event?.water_year ?? null,
  );
  if (!event || !series || series.points.length === 0) return null;

  const { points } = series;
  const max = Math.max(...points.map((p) => p.crashes), event.baseline_daily_crashes, 1);
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / points.length;
  const barW = step * 0.7;
  const floor = PAD_T + plotH;
  const y = (v: number) => floor - (v / max) * plotH;
  const cx = (i: number) => PAD_X + i * step + step / 2;
  const firstIdx = Math.max(points.findIndex((p) => p.is_first_rain), 0);
  const last = points.length - 1;
  const labelFill = "rgb(var(--on-surface-variant))";

  return (
    <figure className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 ambient-shadow overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${event.county_name}: daily crashes from 14 days before to 14 days after the first rain on ${formatDay(event.first_rain_date)}`}
      >
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={cx(i) - barW / 2}
            y={y(p.crashes)}
            width={barW}
            height={floor - y(p.crashes)}
            fill={p.is_first_rain ? "rgb(var(--error))" : labelFill}
          >
            <title>
              {`${formatDay(p.date)}: ${p.crashes.toLocaleString()} crashes${
                p.precip_in > 0 ? `, ${p.precip_in.toFixed(2)} in rain` : ""
              }`}
            </title>
          </rect>
        ))}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={y(event.baseline_daily_crashes)}
          y2={y(event.baseline_daily_crashes)}
          stroke="rgb(var(--on-surface))"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={cx(0)} y={H - 8} fontSize={11} fill={labelFill} textAnchor="start">
          −14 days
        </text>
        <text x={cx(firstIdx)} y={H - 8} fontSize={11} fill="rgb(var(--error))" textAnchor="middle">
          first rain
        </text>
        <text x={cx(last)} y={H - 8} fontSize={11} fill={labelFill} textAnchor="end">
          +14 days
        </text>
      </svg>
      <figcaption className="text-xs text-on-surface-variant text-center mt-3 italic font-serif">
        {event.county_name}: {event.crashes_on_day.toLocaleString()} crashes on{" "}
        {formatDay(event.first_rain_date)} vs{" "}
        {Math.round(event.baseline_daily_crashes).toLocaleString()}/day before —{" "}
        {formatLift(event.lift_pct)}
        {event.small_baseline && " (small baseline — treat with caution)"}
      </figcaption>
    </figure>
  );
}
