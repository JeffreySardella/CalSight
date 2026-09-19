import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useTractBurden } from "../../hooks/useTractBurden";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

/** Matches TractBurdenLayer's CES_HIGHLIGHT. */
const CES_HIGHLIGHT = "#f59e0b";

/**
 * Legend for the tract equity layer — and the place the two caveats the
 * layer can't be shown without actually live.
 *
 * The coverage figure is computed by the API from the selected years, not
 * hard-coded at "~37%": a filter on 2020-2025 has much better coordinate
 * coverage than one that reaches back to 2001, and printing the statewide
 * average over a recent slice would understate the map.
 */
export default function TractBurdenLegend() {
  const { otherLayers, palette } = useLayersState();
  const { selectedDateRange } = useFilterParams();
  const isDark = useIsDark();
  const enabled = otherLayers.tractBurden;
  const { data, isLoading, isError } = useTractBurden(selectedDateRange, enabled);

  if (!enabled) return null;

  const colors = getPalette(palette, isDark);
  const coordPct =
    data?.summary.coord_share != null
      ? Math.round(data.summary.coord_share * 100)
      : null;
  const rate = data?.summary.population_available ?? false;

  return (
    <div
      data-testid="tract-burden-legend"
      className="absolute z-20 bottom-24 left-2 md:bottom-8 md:left-4 w-[220px] bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-2 md:p-3 ghost-border"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
        Equity (tracts)
      </span>

      <div className="flex h-3 rounded-sm overflow-hidden">
        {colors.map((c, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1 font-mono">
        <span>fewer</span>
        <span>more</span>
      </div>
      <div className="text-[10px] text-on-surface-variant leading-tight">
        {rate ? "crashes per 1,000 residents" : "crashes"}
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <span
          aria-hidden="true"
          className="inline-block w-3.5 h-3.5 rounded-sm border-2"
          style={{ borderColor: CES_HIGHLIGHT }}
        />
        <span className="text-[10px] text-on-surface-variant leading-tight">
          Outlined: top CalEnviroScreen quartile (most environmentally burdened)
        </span>
      </div>

      {isLoading && (
        <p className="text-[10px] text-on-surface-variant mt-2 italic">Loading tracts…</p>
      )}
      {isError && (
        <p role="alert" className="text-[10px] text-error mt-2">
          Couldn&apos;t load tract data
        </p>
      )}

      <p className="text-[10px] text-on-surface-variant mt-2 leading-snug">
        {coordPct != null ? (
          <>
            Covers only the <span className="font-mono font-semibold">{coordPct}%</span> of
            crashes in the selected years that have coordinates.
          </>
        ) : (
          <>Covers only crashes that have coordinates.</>
        )}{" "}
        Shading shows where recorded crashes and environmental burden coincide —
        an association, not a cause.
      </p>
    </div>
  );
}
