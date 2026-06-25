import { Link } from "react-router-dom";

const footerLinks = [
  { label: "Data Sources", to: "/about#data-sources" },
  { label: "Methodology", to: "/about#mission" },
  { label: "Project Info", to: "/about" },
  { label: "Privacy Policy", to: "/privacy" },
];

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
        <p className="font-body text-xs text-on-surface-variant max-w-md text-center md:text-left">
          CalSight is an independent project and is not affiliated with, endorsed by,
          or operated by the California Highway Patrol, Caltrans, or the State of California.
        </p>
      </div>
      <div className="flex flex-wrap justify-center md:justify-start gap-4 md:gap-8 font-body text-xs uppercase tracking-widest">
        {footerLinks.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="text-on-surface-variant hover:underline decoration-outline-variant hover:text-on-surface transition-colors min-h-[44px] flex items-center py-2"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
