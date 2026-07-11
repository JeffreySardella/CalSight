import type { DataQualityDisclaimers } from "../../hooks/useDataQualityDisclaimer";

/**
 * Surfaces the data-quality disclaimers computed by useDataQualityDisclaimer
 * (#293) — the hook existed but its output was never rendered. Shown in the
 * Stats dashboard header area, styled after DataFreshnessBanner's stale
 * (amber) state so warnings share one visual language.
 */
export default function DataQualityNotice({ disclaimers }: { disclaimers: DataQualityDisclaimers }) {
  const notes: string[] = [];

  if (disclaimers.preDataOnly) {
    notes.push(
      "Demographic details (age, gender, sobriety) aren't available for the selected years — CCRS reporting starts in 2016.",
    );
  } else if (disclaimers.hasPreCcrsYears) {
    notes.push(
      "Your selection includes years before 2016 — demographic breakdowns cover 2016 onward only.",
    );
  }
  if (disclaimers.hasPreAcsYears) {
    notes.push(
      "Per-capita rates may be missing for smaller counties before 2009 (ACS 1-year estimates only cover populations of 65K+).",
    );
  }
  if (disclaimers.showAgeWarning && disclaimers.agePct != null) {
    notes.push(
      `Driver age is recorded for only ${Math.round(disclaimers.agePct)}% of crashes in this scope — age breakdowns may under-count.`,
    );
  }
  if (disclaimers.showGenderWarning && disclaimers.genderPct != null) {
    notes.push(
      `Gender is recorded for only ${Math.round(disclaimers.genderPct)}% of crashes in this scope — gender breakdowns may under-count.`,
    );
  }

  if (notes.length === 0) return null;

  return (
    <section
      role="note"
      aria-label="Data quality notes"
      className="flex items-start gap-3 rounded-lg px-4 py-3 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      data-print-hide
    >
      <span className="material-symbols-outlined text-[18px] flex-shrink-0 mt-0.5" aria-hidden="true">
        warning
      </span>
      <div className="space-y-1">
        {notes.map((note) => (
          <p key={note} className="text-xs leading-snug">{note}</p>
        ))}
      </div>
    </section>
  );
}
