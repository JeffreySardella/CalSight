interface Props {
  position: "before" | "after";
}

/**
 * Visual insertion indicator shown during drag-and-drop reorder.
 * Renders a horizontal line with dot endpoints to show where a card will land.
 */
export default function DragDropIndicator({ position }: Props) {
  return (
    <div
      className={`drag-drop-indicator ${position === "before" ? "drag-drop-indicator-before" : "drag-drop-indicator-after"}`}
      aria-hidden="true"
    >
      <div className="drag-drop-indicator-line" />
    </div>
  );
}
