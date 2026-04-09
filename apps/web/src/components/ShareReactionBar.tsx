import { useState } from "react";
import { reactionOptions, type ReactionCounts, type ReactionKey } from "../share-reactions";

type Props = {
  reactionCounts: ReactionCounts;
  viewerReactionKey: ReactionKey | null;
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  onSelect: (key: ReactionKey) => void;
};

export default function ShareReactionBar({
  reactionCounts,
  viewerReactionKey,
  disabled = false,
  disabledReason,
  pending = false,
  onSelect,
}: Props) {
  const isDisabled = disabled || pending;
  const [showHint, setShowHint] = useState(false);

  return (
    <div
      className="share-reaction-bar-wrap"
      onMouseEnter={() => { if (isDisabled && disabledReason) setShowHint(true); }}
      onMouseLeave={() => setShowHint(false)}
    >
      <div
        className="share-reaction-bar"
        data-testid="share-reaction-bar"
        role="group"
        aria-label="Share reactions"
        aria-busy={pending || undefined}
      >
        {reactionOptions.map((option) => {
          const isSelected = viewerReactionKey === option.key;

          return (
            <button
              key={option.key}
              type="button"
              className={`share-reaction-chip${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => onSelect(option.key)}
            >
              <span className="share-reaction-chip-emoji" aria-hidden="true">{option.emoji}</span>
              <span>{option.label}</span>
              <span className="share-reaction-chip-count">{reactionCounts[option.key]}</span>
            </button>
          );
        })}
      </div>
      {showHint && disabledReason ? (
        <div className="share-reaction-hint" role="tooltip">{disabledReason}</div>
      ) : null}
    </div>
  );
}
