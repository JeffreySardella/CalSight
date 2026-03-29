const HOURLY_HEIGHTS = [
  20, 15, 12, 10, 14, 18, 45, 65, 80, 70, 60, 55, 62, 68, 75, 85, 100, 92,
  88, 75, 60, 50, 40, 30,
];

const PEAK_HOUR = 16;

const YEARLY_DATA: { year: number; height: number; isPeak: boolean }[] = [
  { year: 2014, height: 40, isPeak: false },
  { year: 2015, height: 45, isPeak: false },
  { year: 2016, height: 55, isPeak: false },
  { year: 2017, height: 75, isPeak: false },
  { year: 2018, height: 100, isPeak: true },
  { year: 2019, height: 85, isPeak: false },
  { year: 2020, height: 50, isPeak: false },
  { year: 2021, height: 65, isPeak: false },
  { year: 2022, height: 70, isPeak: false },
  { year: 2023, height: 78, isPeak: false },
];

const CAUSES: {
  label: string;
  pct: number;
  incidents: string;
  colorClass: string;
  dashoffset: number;
}[] = [
  {
    label: "Speeding",
    pct: 42,
    incidents: "5,292 incidents",
    colorClass: "text-primary",
    dashoffset: 72.3,
  },
  {
    label: "DUI",
    pct: 18,
    incidents: "2,259 incidents",
    colorClass: "text-tertiary",
    dashoffset: 103,
  },
  {
    label: "Distraction",
    pct: 12,
    incidents: "1,522 incidents",
    colorClass: "text-secondary",
    dashoffset: 110.2,
  },
];

function DonutRing({
  pct,
  colorClass,
  dashoffset,
}: {
  pct: number;
  colorClass: string;
  dashoffset: number;
}) {
  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg className="w-12 h-12 -rotate-90">
        <circle
          className="text-surface-container"
          cx="24"
          cy="24"
          r="20"
          fill="transparent"
          stroke="currentColor"
          strokeWidth="4"
        />
        <circle
          className={colorClass}
          cx="24"
          cy="24"
          r="20"
          fill="transparent"
          stroke="currentColor"
          strokeDasharray="125.6"
          strokeDashoffset={dashoffset}
          strokeWidth="4"
        />
      </svg>
      <span className="absolute text-[10px] font-bold">{pct}%</span>
    </div>
  );
}

export default function StatsPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-6 py-8 space-y-8 relative">
      {/* Filter Summary Bar */}
      <section className="bg-surface-container-low rounded-lg px-4 md:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar w-full md:w-auto">
          <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mr-2 flex-shrink-0">
            Filters:
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {["Los Angeles County", "2023", "Fatal"].map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center gap-1 bg-surface-container-highest px-3 py-1 rounded-full text-xs font-medium text-on-surface whitespace-nowrap"
              >
                {chip}
                <span className="material-symbols-outlined text-[16px] cursor-pointer">
                  close
                </span>
              </span>
            ))}
          </div>
        </div>
        <a
          className="text-primary text-xs font-bold uppercase tracking-wider flex items-center gap-1 hover:underline flex-shrink-0"
          href="#"
        >
          Edit Filters
          <span className="material-symbols-outlined text-[16px]">tune</span>
        </a>
      </section>

      {/* Hero Metrics Row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Incidents */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            Total Incidents
          </p>
          <div className="flex items-baseline gap-3">
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              12,482
            </h2>
            <span className="text-error text-sm font-bold flex items-center">
              <span className="material-symbols-outlined text-[18px]">
                trending_up
              </span>
              +4.2%
            </span>
          </div>
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Relative to previous fiscal cycle
          </p>
        </div>

        {/* Avg Response Time */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            Avg. Response Time
          </p>
          <div className="flex items-baseline gap-3">
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              6.2m
            </h2>
            <span className="text-primary text-sm font-bold flex items-center">
              <span className="material-symbols-outlined text-[18px]">
                trending_down
              </span>
              -1.1%
            </span>
          </div>
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Average statewide EMS dispatch
          </p>
        </div>

        {/* Vision Zero Progress */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            Vision Zero Progress
          </p>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              82%
            </h2>
            <span className="text-on-surface-variant text-[10px] font-mono tracking-tighter">
              TARGET: 100%
            </span>
          </div>
          <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: "82%" }}
            />
          </div>
        </div>
      </section>

      {/* Bento Chart Grid */}
      <section className="grid grid-cols-12 gap-6">
        {/* Crash Density by Hour */}
        <div className="col-span-12 md:col-span-8 bg-surface-container-lowest rounded-lg p-8 ambient-shadow">
          <div className="flex justify-between items-start mb-10">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-lg leading-tight">
                Crash Density by Hour
              </h3>
              <p className="text-on-surface-variant text-xs font-medium">
                Temporal distribution across 24-hour cycle
              </p>
            </div>
            <span className="material-symbols-outlined text-outline-variant">
              query_stats
            </span>
          </div>
          <div className="h-48 flex items-end justify-between gap-1 px-2">
            {HOURLY_HEIGHTS.map((h, i) => {
              const isPeak = i === PEAK_HOUR;
              return (
                <div
                  key={i}
                  className="relative w-full"
                  style={{ height: `${h}%` }}
                >
                  {isPeak && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-primary uppercase tracking-widest whitespace-nowrap">
                      PEAK
                    </span>
                  )}
                  <div
                    className={`w-full h-full rounded-t-sm transition-colors ${
                      isPeak
                        ? "bg-primary"
                        : "bg-primary-container hover:bg-primary"
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-4 px-1 text-[10px] text-on-surface-variant font-mono uppercase font-semibold">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:59</span>
          </div>
        </div>

        {/* Primary Cause */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-8 leading-tight">
            Primary Cause
          </h3>
          <div className="space-y-6">
            {CAUSES.map((cause) => (
              <div key={cause.label} className="flex items-center gap-4">
                <DonutRing
                  pct={cause.pct}
                  colorClass={cause.colorClass}
                  dashoffset={cause.dashoffset}
                />
                <div>
                  <p className="text-sm font-bold text-on-surface">
                    {cause.label}
                  </p>
                  <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold">
                    {cause.incidents}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Incidents by Year */}
        <div className="col-span-12 bg-surface-container-lowest rounded-lg p-8 ambient-shadow">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-xl leading-tight">
                Incidents by Year (2014-2023)
              </h3>
              <p className="text-on-surface-variant text-sm">
                Longitudinal dataset showing historical trends
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="bg-surface-container-low px-4 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">
                  download
                </span>
                CSV
              </button>
              <button className="bg-surface-container-low px-4 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">
                  picture_as_pdf
                </span>
                PDF
              </button>
            </div>
          </div>
          <div className="h-64 flex items-end justify-between gap-4 px-4 pb-2">
            {YEARLY_DATA.map(({ year, height, isPeak }) => (
              <div
                key={year}
                className="flex flex-col items-center flex-1 gap-2"
              >
                <div
                  className={`w-full rounded-t-md ${
                    isPeak ? "bg-error" : "bg-primary-container"
                  }`}
                  style={{ height: `${height}%` }}
                />
                <span
                  className={`text-[10px] font-bold ${
                    isPeak
                      ? "text-on-surface italic"
                      : "text-on-surface-variant"
                  }`}
                >
                  {isPeak ? `${year}*` : year}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[10px] text-on-surface-variant italic leading-relaxed">
            * Note: 2018 data represents a statistically significant anomaly due
            to regional reporting calibration. Data accuracy remains within 99.4%
            confidence interval.
          </p>
        </div>
      </section>

      {/* Mobile share FAB */}
      <button className="fixed bottom-24 right-6 z-40 md:hidden w-14 h-14 bg-primary text-on-primary rounded-full shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity">
        <span
          className="material-symbols-outlined text-[24px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          share
        </span>
      </button>

      {/* Methodology Footer */}
      <section className="border-t border-outline-variant/15 pt-12 pb-16 opacity-60 hover:opacity-100 transition-opacity">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-[10px] leading-relaxed uppercase tracking-widest font-medium text-on-surface-variant">
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-[11px]">
              Methodology Statement
            </h4>
            <p>
              Calculations based on integrated records from the Statewide
              Integrated Traffic Records System (SWITRS). Data is processed
              through an iterative algorithmic cleanup to normalize reporting
              variations across jurisdictions. Temporal density charts are
              weighted by population density per census tract to ensure
              rural-urban parity.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-[11px]">
              California Public Records Act
            </h4>
            <p>
              This information is presented in compliance with CA Gov Code
              &sect; 6250. Access to the raw ledger for independent auditing is
              available upon verification. System Ledger Hash ID:
              8821-X-CALSIGHT-DASH-04. Version 4.2.1.0 Institutional
              Transparency Protocol.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
