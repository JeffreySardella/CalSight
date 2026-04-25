interface BreadcrumbProps {
  inspectedCounty: string | null;
  compareCounty: string | null;
  onDeselect: () => void;
}

export default function Breadcrumb({ inspectedCounty, compareCounty, onDeselect }: BreadcrumbProps) {
  const hasSelection = inspectedCounty !== null;

  let label: React.ReactNode;
  if (inspectedCounty && compareCounty) {
    label = <span className="text-on-surface">{inspectedCounty} <span className="text-on-surface/60">vs</span> {compareCounty}</span>;
  } else if (inspectedCounty) {
    label = <span className="text-on-surface">{inspectedCounty} County</span>;
  } else {
    label = <span className="text-on-surface">Map Explorer</span>;
  }

  return (
    <div className="hidden md:block absolute top-8 left-8 z-10 pointer-events-auto">
      <div className="bg-surface-container-lowest/40 backdrop-blur-sm px-4 py-2 rounded-lg">
        <p className="text-[11px] font-medium tracking-[0.3em] text-on-surface/60 uppercase">
          {hasSelection ? (
            <button
              onClick={onDeselect}
              className="hover:underline hover:text-on-surface/80 cursor-pointer transition-colors"
            >
              State Index
            </button>
          ) : (
            <span>State Index</span>
          )}
          <span className="mx-2">/</span>
          {label}
        </p>
      </div>
    </div>
  );
}
