interface Props {
  onClick: () => void;
}

export default function AddChartCard({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="bg-surface-container-lowest rounded-2xl p-4 ambient-shadow border-2 border-dashed border-outline-variant hover:border-primary hover:bg-surface-container-low transition-colors flex flex-col items-center justify-center gap-3 min-h-[200px] text-on-surface-variant hover:text-primary"
    >
      <span className="material-symbols-outlined text-[36px]" aria-hidden="true">add</span>
      <span className="text-sm font-medium">Add Chart</span>
    </button>
  );
}
