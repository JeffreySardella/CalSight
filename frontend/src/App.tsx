import { useState } from "react";
import Header from "./components/Header";
import FilterSidebar from "./components/FilterSidebar";
import MapPanel from "./components/MapPanel";
import ChartsPanel from "./components/ChartsPanel";
import "./App.css";

export default function App() {
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <>
      <Header onMenuToggle={() => setFilterOpen((o) => !o)} />

      <div className="app-body">
        <FilterSidebar
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
        />

        {filterOpen && (
          <div
            className="filter-overlay"
            onClick={() => setFilterOpen(false)}
            aria-hidden="true"
          />
        )}

        <main id="main-content" className="app-main">
          <section className="map-section" aria-label="Crash density map">
            <MapPanel />
          </section>

          <aside className="charts-aside" aria-label="Statistics and charts">
            <ChartsPanel />
          </aside>
        </main>
      </div>
    </>
  );
}
