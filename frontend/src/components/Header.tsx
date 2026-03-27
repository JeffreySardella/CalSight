import "./Header.css";

interface HeaderProps {
  onMenuToggle?: () => void;
}

function Header({ onMenuToggle }: HeaderProps) {
  return (
    <header className="header-main">
      <button
        className="header-burger"
        onClick={onMenuToggle}
        aria-label="Toggle filters"
      >
        <span />
        <span />
        <span />
      </button>

      <div className="header-logo">CS</div>

      <div className="header-title">
        <span className="header-title-cal">Cal</span>
        <span className="header-title-sight">Sight</span>
      </div>

      <nav className="header-link">
        <a href="">Dashboard</a> {/* TODO: Add the route */}
        <a href="">About</a>     {/* TODO: Add the route */}
        <a
          href="https://github.com/JeffreySardella/CalSight"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </nav>

      <div className="header-badge">CCRS 2022-2026</div>
    </header>
  );
}

export default Header;
