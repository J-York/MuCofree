import { z } from "zod";

export const reactionKeys = ["slacking", "boost", "healing", "after_work", "loop"] as const;

export const reactionSchema = z.enum(reactionKeys);

export type ReactionKey = z.infer<typeof reactionSchema>;
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
