interface Props {
  suggestions: string[];
  onSelect: (question: string) => void;
}

export default function SuggestionChips({ suggestions, onSelect }: Props) {
  if (!suggestions.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4 ml-4">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className="text-xs bg-tertiary-container text-on-tertiary-container px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity min-h-[44px] flex items-center"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
