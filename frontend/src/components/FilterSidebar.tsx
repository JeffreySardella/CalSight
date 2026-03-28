import "./FilterSidebar.css";

interface FilterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FilterSidebar({ isOpen, onClose }: FilterSidebarProps) {
  return (
    <aside
      className={`filter-sidebar${isOpen ? " filter-sidebar--open" : ""}`}
      aria-label="Map filters"
    >
      <div className="filter-sidebar-header">
        <span className="filter-sidebar-title">Filters</span>
        <button
          className="filter-sidebar-close"
          onClick={onClose}
          aria-label="Close filters"
        >
          ✕
        </button>
      </div>

      <div className="filter-sidebar-body"></div>
    </aside>
  );
}
