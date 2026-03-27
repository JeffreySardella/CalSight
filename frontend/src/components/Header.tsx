import "./Header.css";

function Header() {
  return (
    <header className="header-main">
      <div className="header-logo">CS</div>

      <div className="header-title">
        <span className="header-title-cal">Cal</span>
        <span className="header-title-sight">Sight</span>
      </div>

      <nav className="header-link">
        <a href="">Dashboard</a> {/* TODO: Add the route */}
        <a href="">About</a>     {/* TODO: Add the route */}
        <a href="https://github.com/JeffreySardella/CalSight">GitHub</a>
      </nav>

      <div className="header-badge">CCRS 2022-2026</div>
    </header>
  );
}

export default Header;
