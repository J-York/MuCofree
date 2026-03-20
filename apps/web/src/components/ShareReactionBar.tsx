import { reactionOptions, type ReactionCounts, type ReactionKey } from "../share-reactions";

type Props = {
  reactionCounts: ReactionCounts;
  viewerReactionKey: ReactionKey | null;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (key: ReactionKey) => void;
};

export default function ShareReactionBar({
  reactionCounts,
  viewerReactionKey,
  disabled = false,
  pending = false,
  onSelect,
}: Props) {
  const isDisabled = disabled || pending;

  return (
    <div className="share-reaction-bar" data-testid="share-reaction-bar" aria-busy={pending || undefined}>
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
  );
}
