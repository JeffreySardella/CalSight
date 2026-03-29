const AGE_DISTRIBUTION = [
  { label: "0-17 yrs", pct: 22, color: "bg-primary" },
  { label: "18-34 yrs", pct: 28, color: "bg-primary-fixed-dim" },
  { label: "35-54 yrs", pct: 32, color: "bg-primary-container" },
  { label: "55+ yrs", pct: 18, color: "bg-tertiary" },
] as const;

const COMMUTER_MODES = [
  { label: "Drive Alone", pct: 65, color: "bg-primary" },
  { label: "Carpool", pct: 12, color: "bg-primary-dim" },
  { label: "Transit", pct: 11, color: "bg-tertiary" },
] as const;

const PARTY_TYPES = [
  { label: "Driver", pct: 72, color: "bg-primary" },
  { label: "Pedestrian", pct: 14, color: "bg-tertiary" },
  { label: "Cyclist", pct: 8, color: "bg-secondary" },
  { label: "Motorcyclist", pct: 6, color: "bg-primary-fixed-dim" },
] as const;

const AGE_GROUPS = [
  { label: "16-25", pct: 35 },
  { label: "26-35", pct: 42 },
  { label: "36-50", pct: 28 },
  { label: "51-65", pct: 18 },
  { label: "65+", pct: 8 },
] as const;

const TIME_OF_DAY = [
  { label: "Morning", pct: 15 },
  { label: "Afternoon", pct: 30 },
  { label: "Evening", pct: 35 },
  { label: "Night", pct: 20 },
] as const;

export default function DemographicsPanel() {
  return (
    <div className="space-y-8 pb-32">
      {/* County Context */}
      <div className="space-y-6">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          County Context
        </h3>

        {/* Population */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-1 font-body">
            Population
          </span>
          <div className="text-4xl font-extrabold tracking-tighter font-headline text-on-surface">
            10.04M
          </div>
        </div>

        {/* Age Distribution */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-3 font-body">
            Age Distribution
          </span>
          <div className="flex h-3 w-full overflow-hidden rounded-full mb-4 bg-surface-container">
            {AGE_DISTRIBUTION.map(({ label, pct, color }) => (
              <div
                key={label}
                className={`${color} h-full`}
                style={{ width: `${pct}%` }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            {AGE_DISTRIBUTION.map(({ label, pct, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${color}`} />
                <span className="text-[11px] font-medium text-on-surface-variant font-body">
                  {label} ({pct}%)
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Median Income */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-1 font-body">
            Median HH Income
          </span>
          <div className="text-3xl font-bold tracking-tighter font-headline text-on-surface">
            $72,800
          </div>
        </div>

        {/* Commuter Mode Share */}
        <div className="space-y-4">
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block font-body">
            Commuter Mode Share
          </span>
          <div className="space-y-3">
            {COMMUTER_MODES.map(({ label, pct, color }) => (
              <div key={label}>
                <div className="flex justify-between items-center text-[11px] mb-1 font-body">
                  <span className="font-medium text-on-surface">{label}</span>
                  <span className="text-on-surface-variant">{pct}%</span>
                </div>
                <div className="h-1 w-full bg-surface-container rounded-full">
                  <div
                    className={`h-full ${color} rounded-full`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Crash Demographics */}
      <div className="space-y-6">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Crash Demographics
        </h3>

        {/* Involved Party Type */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-4 font-body">
            Involved Party Type
          </span>
          <div className="space-y-3">
            {PARTY_TYPES.map(({ label, pct, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-[11px] w-16 font-medium text-on-surface font-body">
                  {label}
                </span>
                <div className="flex-1 h-4 bg-surface-container rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-on-surface-variant font-body">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Age Groups */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-4 font-body">
            Age Groups (Primary Party)
          </span>
          <div className="space-y-2">
            {AGE_GROUPS.map(({ label, pct }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] w-10 text-on-surface-variant font-body">
                  {label}
                </span>
                <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-dim rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Time of Day */}
        <div>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant block mb-4 font-body">
            Time of Day
          </span>
          <div className="grid grid-cols-4 gap-2">
            {TIME_OF_DAY.map(({ label, pct }) => (
              <div
                key={label}
                className="bg-primary rounded-lg p-2 text-center"
                style={{ opacity: 0.3 + (pct / 35) * 0.7 }}
              >
                <span className="text-[9px] font-bold text-on-primary block">
                  {label}
                </span>
                <span className="text-[11px] font-bold text-on-primary">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Source */}
      <footer className="pt-4">
        <p className="text-[10px] italic text-on-surface-variant font-body">
          Source: CCRS / US Census Bureau
        </p>
      </footer>
    </div>
  );
}

export function DemographicsPanelFooter() {
  return (
    <button
      onClick={() => console.log("Generating county report...")}
      className="w-full bg-primary text-on-primary py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase hover:opacity-90 shadow-lg shadow-primary/20 transition-all"
    >
      Generate County Report
    </button>
  );
}
