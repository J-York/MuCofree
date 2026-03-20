export const reactionOptions = [
  { key: "slacking", emoji: "😮‍💨", label: "摸鱼神曲" },
  { key: "boost", emoji: "⚡", label: "提神" },
  { key: "healing", emoji: "🌤", label: "治愈" },
  { key: "after_work", emoji: "🚇", label: "下班路上" },
  { key: "loop", emoji: "🔁", label: "单曲循环" },
] as const;

export type ReactionKey = (typeof reactionOptions)[number]["key"];
export type ReactionCounts = Record<ReactionKey, number>;

export function createEmptyReactionCounts(): ReactionCounts {
  return {
    slacking: 0,
    boost: 0,
    healing: 0,
    after_work: 0,
    loop: 0,
  };
}

export function applyOptimisticReaction(
  reactionCounts: ReactionCounts,
  viewerReactionKey: ReactionKey | null,
  clickedReactionKey: ReactionKey,
): { reactionCounts: ReactionCounts; viewerReactionKey: ReactionKey | null } {
  const nextReactionCounts = { ...reactionCounts };
  const isRemovingReaction = viewerReactionKey === clickedReactionKey;

  if (viewerReactionKey) {
    nextReactionCounts[viewerReactionKey] = Math.max(0, nextReactionCounts[viewerReactionKey] - 1);
  }

  if (!isRemovingReaction) {
    nextReactionCounts[clickedReactionKey] += 1;
  }

  return {
    reactionCounts: nextReactionCounts,
    viewerReactionKey: isRemovingReaction ? null : clickedReactionKey,
  };
}
