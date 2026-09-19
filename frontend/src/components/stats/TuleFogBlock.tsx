import { useFogDays } from "../../hooks/useFogDays";
import { formatLift } from "../../hooks/useFirstRain";

const W = 600;
const H = 210;
const PAD_X = 8;
const PAD_T = 12;
const PAD_B = 34;
/** Below this many fog days a year's average is a coin flip, so it is drawn
 *  but never counted in the headline. */
const MIN_FOG_DAYS = 3;

/**
 * Story block: for one county, the average daily crash count on days a NOAA
 * dense-fog advisory covered it, against every other day in the same calendar
 * months, year by year. Renders nothing until the endpoint answers, so the
 * story can carry it before the loader has run.
 */
export default function TuleFogBlock({ countySlug }: { countySlug: string }) {
  const { data } = useFogDays(countySlug);
  const county = data?.counties?.[0] ?? null;
  const years = county?.years ?? [];
  if (!county || years.length === 0) return null;

  const max = Math.max(
    ...years.map((y) => Math.max(y.fog_day_avg_crashes, y.baseline_avg_crashes)),
    1,
  );
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / years.length;
  const barW = Math.min(step * 0.38, 18);
  const floor = PAD_T + plotH;
  const y = (v: number) => floor - (v / max) * plotH;
  const cx = (i: number) => PAD_X + i * step + step / 2;
  const labelFill = "rgb(var(--on-surface-variant))";

  const counted = years.filter((r) => r.fog_event_days >= MIN_FOG_DAYS);
  const fogDays = counted.reduce((a, r) => a + r.fog_event_days, 0);
  const fogCrashes = counted.reduce((a, r) => a + r.crashes_on_fog_days, 0);
  const baseDays = counted.reduce((a, r) => a + r.baseline_days, 0);
  const baseCrashes = counted.reduce(
    (a, r) => a + r.baseline_avg_crashes * r.baseline_days,
    0,
  );
  const fogAvg = fogDays > 0 ? fogCrashes / fogDays : 0;
  const baseAvg = baseDays > 0 ? baseCrashes / baseDays : 0;
  const lift = baseAvg > 0 ? ((fogAvg - baseAvg) / baseAvg) * 100 : null;

  return (
    <figure className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 ambient-shadow overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${county.county_name}: average daily crashes on dense-fog advisory days compared with other days in the same months, by year`}
      >
        {years.map((r, i) => (
          <g key={r.year}>
            <rect
              x={cx(i) - barW - 1}
              y={y(r.fog_day_avg_crashes)}
              width={barW}
              height={floor - y(r.fog_day_avg_crashes)}
              fill="rgb(var(--error))"
            >
              <title>
                {`${r.year}: ${r.fog_day_avg_crashes.toLocaleString()} crashes/day across ${r.fog_event_days} fog-advisory day${r.fog_event_days === 1 ? "" : "s"}`}
              </title>
            </rect>
            <rect
              x={cx(i) + 1}
              y={y(r.baseline_avg_crashes)}
              width={barW}
              height={floor - y(r.baseline_avg_crashes)}
              fill={labelFill}
            >
              <title>
                {`${r.year}: ${r.baseline_avg_crashes.toLocaleString()} crashes/day across ${r.baseline_days} other days in the same months`}
              </title>
            </rect>
          </g>
        ))}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={floor}
          y2={floor}
          stroke={labelFill}
          strokeWidth={1}
        />
        <text x={cx(0)} y={H - 20} fontSize={11} fill={labelFill} textAnchor="start">
          {years[0].year}
        </text>
        <text
          x={cx(years.length - 1)}
          y={H - 20}
          fontSize={11}
          fill={labelFill}
          textAnchor="end"
        >
          {years[years.length - 1].year}
        </text>
        <text x={PAD_X} y={H - 6} fontSize={11} fill="rgb(var(--error))" textAnchor="start">
          fog-advisory days
        </text>
        <text x={W - PAD_X} y={H - 6} fontSize={11} fill={labelFill} textAnchor="end">
          every other day, same months
        </text>
      </svg>
      <figcaption className="text-xs text-on-surface-variant text-center mt-3 italic font-serif">
        {county.county_name}: {fogAvg.toFixed(1)} crashes/day across {fogDays.toLocaleString()}{" "}
        fog-advisory days vs {baseAvg.toFixed(1)}/day otherwise
        {lift !== null && ` — ${formatLift(lift)}`}. Association, not cause.
      </figcaption>
    </figure>
  );
}
