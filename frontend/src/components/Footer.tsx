export default function Footer() {
  return (
    <footer className="bg-surface-container pb-24 md:pb-12 pt-12 flex flex-col md:flex-row justify-between items-center px-8 w-full">
      <div className="flex flex-col items-center md:items-start gap-2 mb-6 md:mb-0">
        <span className="text-sm font-bold text-on-surface font-headline">
          CalSight
        </span>
        <p className="font-body text-xs uppercase tracking-widest text-on-surface-variant">
          © 2026 CalSight. Data Methodology & Institutional Transparency.
        </p>
      </div>
      <div className="flex flex-wrap justify-center md:justify-start gap-4 md:gap-8 font-body text-xs uppercase tracking-widest">
        {["Data Sources", "Methodology", "Project Info", "Privacy Policy"].map(
          (label) => (
            <a
              key={label}
              href="#"
              className="text-on-surface-variant hover:underline decoration-outline-variant opacity-80 hover:opacity-100 transition-opacity"
            >
              {label}
            </a>
          )
        )}
      </div>
    </footer>
  );
}
