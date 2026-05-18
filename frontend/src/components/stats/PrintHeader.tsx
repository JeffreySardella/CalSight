/**
 * PrintHeader — visible only in print/print-preview mode.
 * Shows CalSight branding, active filter summary, and generation timestamp.
 */
import logo from "../../assets/logo.webp";

interface FilterSummary {
  counties: string[];
  dateRange: string | null;
  severities: string[];
  causes: string[];
  involvements: string[];
}

interface Props {
  filters: FilterSummary;
}

export default function PrintHeader({ filters }: Props) {
  const now = new Date();
  const timestamp = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const filterParts: string[] = [];
  if (filters.counties.length > 0) {
    filterParts.push(`Counties: ${filters.counties.join(", ")}`);
  } else {
    filterParts.push("Counties: All");
  }
  if (filters.dateRange) {
    filterParts.push(`Date Range: ${filters.dateRange}`);
  } else {
    filterParts.push("Date Range: All Years");
  }
  if (filters.severities.length > 0) {
    filterParts.push(`Severities: ${filters.severities.join(", ")}`);
  }
  if (filters.causes.length > 0) {
    filterParts.push(`Causes: ${filters.causes.join(", ")}`);
  }
  if (filters.involvements.length > 0) {
    filterParts.push(`Involvement: ${filters.involvements.join(", ")}`);
  }

  return (
    <div className="print-header" aria-hidden="true">
      <div className="print-header__brand">
        <img src={logo} alt="" className="print-header__logo" />
        <div className="print-header__title">
          <span className="print-header__name">CalSight</span>
          <span className="print-header__subtitle">California Crash Data Explorer</span>
        </div>
      </div>
      <div className="print-header__meta">
        <p className="print-header__timestamp">Generated: {timestamp}</p>
      </div>
      {filterParts.length > 0 && (
        <div className="print-header__filters">
          <span className="print-header__filters-label">Active Filters:</span>
          {filterParts.map((part) => (
            <span key={part} className="print-header__filter-chip">{part}</span>
          ))}
        </div>
      )}
      <div className="print-header__divider" />
    </div>
  );
}
