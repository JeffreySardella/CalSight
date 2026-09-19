import { formatLift, formatRate, useHolidays } from "../../hooks/useHolidays";

/**
 * Story block: one row per holiday period, comparing crashes and deaths per
 * day and DUI share against ordinary days of the same month. Every figure
 * comes from /api/holidays — nothing here is hard-coded, so the story cannot
 * drift away from the data.
 *
 * Renders nothing until the payload has holidays: the view is refreshed
 * nightly and starts empty after a deploy, and a story block that quietly
 * skips itself beats one showing a table of zeroes.
 */
export default function HolidayBlock({ countySlug }: { countySlug?: string | null }) {
  const { data } = useHolidays(countySlug);
  if (!data || data.holidays.length === 0) return null;

  // Shared scale so the bars compare across rows, not just within one.
  const widest = Math.max(
    ...data.holidays.map((h) => Math.abs(h.crashes_lift_pct ?? 0)),
    1,
  );
  const where = data.county_name ? `${data.county_name} County` : "California";

  return (
    <figure className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 ambient-shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">
            {`Crashes, deaths and DUI share on major holiday periods in ${where}, ` +
              `${data.first_year} to ${data.last_year}, against ordinary days of the same month`}
          </caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-on-surface-variant">
              <th scope="col" className="text-left font-bold py-2 pr-2">Holiday</th>
              <th scope="col" className="text-right font-bold py-2 px-2">Crashes/day</th>
              <th scope="col" className="text-right font-bold py-2 px-2">vs ordinary</th>
              <th scope="col" className="text-right font-bold py-2 px-2">Deaths/day</th>
              <th scope="col" className="text-right font-bold py-2 pl-2">DUI share</th>
            </tr>
          </thead>
          <tbody>
            {data.holidays.map((h) => {
              const lift = h.crashes_lift_pct;
              const up = (lift ?? 0) > 0;
              return (
                <tr key={h.key} className="border-t border-outline-variant/30">
                  <th scope="row" className="text-left font-medium text-on-surface py-2.5 pr-2">
                    {h.label}
                    <span className="block text-xs font-normal text-on-surface-variant">
                      {`${h.days} days vs ${h.baseline.days} ordinary ${h.baseline_month} days`}
                    </span>
                  </th>
                  <td className="text-right tabular-nums py-2.5 px-2 text-on-surface">
                    {formatRate(h.crashes_per_day)}
                    <span className="block text-xs text-on-surface-variant">
                      {formatRate(h.baseline.crashes_per_day)} ordinary
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={`h-1.5 rounded-full ${up ? "bg-error" : "bg-primary"}`}
                        style={{ width: `${(Math.abs(lift ?? 0) / widest) * 48}px` }}
                        aria-hidden="true"
                      />
                      <span
                        className={`tabular-nums font-semibold ${up ? "text-error" : "text-primary"}`}
                      >
                        {formatLift(lift)}
                      </span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums py-2.5 px-2 text-on-surface">
                    {formatRate(h.deaths_per_day)}
                    <span className="block text-xs text-on-surface-variant">
                      {formatLift(h.deaths_lift_pct)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums py-2.5 pl-2 text-on-surface">
                    {`${h.dui_share_pct.toFixed(1)}%`}
                    <span className="block text-xs text-on-surface-variant">
                      {formatLift(h.dui_share_lift_pct)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <figcaption className="text-xs text-on-surface-variant mt-3 italic font-serif leading-relaxed">
        {`${where}, ${data.first_year} to ${data.last_year}. Each holiday is compared with the ` +
          `ordinary days of its own month in the same year, so season and daylight are held ` +
          `roughly constant. The source is daily rather than hourly, so Halloween is counted ` +
          `as the whole of October 31 and November 1, daytime hours either side of the night ` +
          `included. DUI means a crash whose primary cause was coded as driving under ` +
          `the influence. Fatality records lag crash records by six months or more, so ` +
          `${data.last_year} is the newest year included and its death counts may still rise.`}
      </figcaption>
    </figure>
  );
}
