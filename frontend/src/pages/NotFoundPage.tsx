import { NavLink, useSearchParams } from "react-router-dom";
import { buildFilterQS } from "../hooks/useFilterParams";

export default function NotFoundPage() {
  const [searchParams] = useSearchParams();
  const qs = buildFilterQS(searchParams);

  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center page-enter">
      <span className="material-symbols-outlined text-[64px] text-on-surface-variant/40 mb-4">
        explore_off
      </span>
      <h1 className="text-3xl font-headline font-bold text-on-surface mb-2">
        Page Not Found
      </h1>
      <p className="text-on-surface-variant max-w-md mb-8">
        We couldn't find that page, but there's plenty of crash data to explore.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <NavLink
          to={qs ? `/?${qs}` : "/"}
          className="px-5 py-2.5 bg-primary text-on-primary rounded-full font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Explore Map
        </NavLink>
        <NavLink
          to={qs ? `/stats?${qs}` : "/stats"}
          className="px-5 py-2.5 bg-surface-container-high text-on-surface rounded-full font-semibold text-sm hover:bg-surface-variant transition-colors"
        >
          View Statistics
        </NavLink>
        <NavLink
          to={qs ? `/ask?${qs}` : "/ask"}
          className="px-5 py-2.5 bg-surface-container-high text-on-surface rounded-full font-semibold text-sm hover:bg-surface-variant transition-colors"
        >
          Ask AI
        </NavLink>
      </div>
    </main>
  );
}
