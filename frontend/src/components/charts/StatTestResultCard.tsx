import type { TestResult, SignificanceLevel } from "../../lib/dashboard/hypothesis";

interface Props {
  result: TestResult;
  compact?: boolean;
}

function significanceBadge(level: SignificanceLevel) {
  const styles: Record<SignificanceLevel, { bg: string; text: string; label: string }> = {
    highly_significant: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-200", label: "p < 0.001" },
    significant: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-200", label: "p < 0.05" },
    marginally_significant: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-200", label: "p < 0.10" },
    not_significant: { bg: "bg-gray-100 dark:bg-gray-800/30", text: "text-gray-600 dark:text-gray-300", label: "Not Significant" },
  };
  const s = styles[level];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function formatStat(value: number | null, decimals = 4): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(2);
  return value.toFixed(decimals);
}

export default function StatTestResultCard({ result, compact = false }: Props) {
  return (
    <div className="bg-surface-container rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-headline font-bold text-on-surface">{result.testName}</h4>
        {significanceBadge(result.significance)}
      </div>

      {/* Key Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox label="Test Statistic" value={formatStat(result.statistic, 3)} />
        <StatBox label="p-value" value={formatStat(result.pValue)} highlight={result.pValue < 0.05} />
        {result.effectSize != null && (
          <StatBox label={result.effectSizeLabel ?? "Effect Size"} value={formatStat(result.effectSize, 3)} />
        )}
        {result.degreesOfFreedom != null && (
          <StatBox label="df" value={String(Math.round(result.degreesOfFreedom * 10) / 10)} />
        )}
        <StatBox label="n" value={String(result.sampleSize)} />
        {result.confidenceInterval && (
          <StatBox
            label="95% CI"
            value={`[${result.confidenceInterval[0].toFixed(3)}, ${result.confidenceInterval[1].toFixed(3)}]`}
          />
        )}
      </div>

      {/* Plain English Interpretation */}
      {!compact && (
        <div className="bg-surface-container-high rounded-lg p-3">
          <p className="text-xs text-on-surface leading-relaxed">{result.interpretation}</p>
        </div>
      )}

      {/* Assumptions & Warnings */}
      {!compact && (result.assumptions.length > 0 || result.warnings.length > 0) && (
        <details className="text-[10px]">
          <summary className="text-on-surface-variant cursor-pointer font-medium">
            Assumptions & Caveats
          </summary>
          <div className="mt-1 space-y-1">
            {result.assumptions.map((a, i) => (
              <p key={i} className="text-on-surface-variant pl-2 border-l-2 border-outline-variant/30">
                {a}
              </p>
            ))}
            {result.warnings.map((w, i) => (
              <p key={`w-${i}`} className="text-amber-700 dark:text-amber-300 pl-2 border-l-2 border-amber-400/50 font-medium">
                {w}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-surface rounded-lg p-2 text-center">
      <p className="text-[9px] text-on-surface-variant uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-mono font-bold ${highlight ? "text-green-600 dark:text-green-400" : "text-on-surface"}`}>
        {value}
      </p>
    </div>
  );
}
