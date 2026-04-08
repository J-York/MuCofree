import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  id: string;
  disabled?: boolean;
  children: ReactNode;
};

export default function SortableSongItem({ id, disabled, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    position: "relative",
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-song-item">
      {!disabled && (
        <button
          ref={setActivatorNodeRef}
          className="drag-handle"
          {...attributes}
          {...listeners}
          tabIndex={0}
          aria-label="拖拽排序"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5.5" cy="3" r="1.2" />
            <circle cx="10.5" cy="3" r="1.2" />
            <circle cx="5.5" cy="8" r="1.2" />
            <circle cx="10.5" cy="8" r="1.2" />
            <circle cx="5.5" cy="13" r="1.2" />
            <circle cx="10.5" cy="13" r="1.2" />
          </svg>
        </button>
      )}
      <div className="sortable-song-content">{children}</div>
    </div>
  );
}
