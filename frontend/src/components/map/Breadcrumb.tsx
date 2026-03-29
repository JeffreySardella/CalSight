export default function Breadcrumb() {
  return (
    <div className="hidden md:block absolute top-8 left-8 z-10 pointer-events-none">
      <div className="bg-surface-container-lowest/40 backdrop-blur-sm px-4 py-2 rounded-lg">
        <p className="text-[11px] font-medium tracking-[0.3em] text-on-surface/60 uppercase">
          State Index{" "}
          <span className="mx-2">/</span>{" "}
          <span className="text-on-surface">Map Explorer</span>
        </p>
      </div>
    </div>
  );
}
