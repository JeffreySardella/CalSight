import { useId, useState, type ReactNode } from "react";

/**
 * Built-in glossary of transportation-data jargon (#304).
 *
 * Keys are the canonical acronyms used across the site. "CES" is an alias
 * for "CalEnviroScreen" — both resolve to the same definition.
 */
const GLOSSARY = {
  SWITRS:
    "Statewide Integrated Traffic Records System — the CHP database of police-reported crashes. On CalSight it covers 2001–2015 and has crash-level records only (no driver demographics).",
  CCRS:
    "California Crash Reporting System — the CHP's current crash database (2016 onward), which includes party-level details such as age, gender, and sobriety.",
  KSI:
    "Killed or Seriously Injured — a standard traffic-safety measure counting crashes that result in a fatality or a severe injury.",
  AADT:
    "Annual Average Daily Traffic — the average number of vehicles passing a point on a road per day, averaged over a full year. Used to measure traffic exposure.",
  CalEnviroScreen:
    "CalEnviroScreen (CES) — a California OEHHA screening tool that scores communities by combined environmental, health, and socioeconomic burdens.",
  CES:
    "CalEnviroScreen (CES) — a California OEHHA screening tool that scores communities by combined environmental, health, and socioeconomic burdens.",
  ACS:
    "American Community Survey — the US Census Bureau's ongoing survey providing annual demographic estimates (population, income, education) by county.",
  FARS:
    "Fatality Analysis Reporting System — NHTSA's national census of fatal motor-vehicle crashes on public roads.",
  VMT:
    "Vehicle Miles Traveled — the total miles driven in an area over a period. Used to normalize crash rates by how much people actually drive.",
  PDO:
    "Property Damage Only — a crash in which no one was injured or killed; only vehicles or property were damaged.",
} as const;

export type JargonKey = keyof typeof GLOSSARY;

interface JargonTermProps {
  /** Glossary key, e.g. "SWITRS". */
  term: JargonKey;
  /** Visible text. Defaults to the term itself. */
  children?: ReactNode;
}

/**
 * Inline jargon term with an accessible definition tooltip (#304).
 *
 * - Rendered as a real <button> so it is keyboard focusable and works on touch.
 * - Tooltip is wired via aria-describedby and role="tooltip".
 * - Opens on hover, focus, or tap/click; closes on blur, mouse-out, or Escape.
 * - Hovering the tooltip itself keeps it open (WCAG 1.4.13 hoverable).
 */
export default function JargonTerm({ term, children }: JargonTermProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const definition = GLOSSARY[term];

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="cursor-help underline decoration-dotted decoration-on-surface-variant/60 underline-offset-2 text-inherit hover:decoration-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children ?? term}
      </button>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 max-w-[80vw] rounded-md bg-surface-container-highest text-on-surface border border-outline-variant shadow-lg px-3 py-2 text-xs leading-relaxed text-left normal-case tracking-normal font-body font-normal"
        >
          {definition}
        </span>
      )}
    </span>
  );
}
