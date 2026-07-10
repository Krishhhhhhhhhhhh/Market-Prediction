import { z } from "zod";

// price is in cents (1-99): a full $1 share-pair = 100 cents, matching
// the split/merge economics below. qty is always a positive integer share count.
export const TradeSchema = z.object({
  marketId: z.string().uuid(),
  side: z.enum(["yes", "no"]),
  price: z.number().int().min(1).max(99), // 10 => $0.10
  qty: z.number().int().positive(), // 10 => 10 shares
});

// qty here = number of YES+NO share pairs to mint/burn (1 pair = $1)
export const SplitMergeSchema = z.object({
  marketId: z.string().uuid(),
  qty: z.number().int().positive(),
});

// USD amounts with real-world money semantics: must be positive and
// carry at most 2 decimal places (cents), so nothing silently rounds away.
export const OnrampSchema = z.object({
  amount: z.number().positive().multipleOf(0.01), // e.g. 100.50
});

export const OfframpSchema = z.object({
  amount: z.number().positive().multipleOf(0.01), // e.g. 100.50
});

export type BookOrder = {
  userId: string;
  type: "buy" | "sell";
  price: number;
  qty: number;
  filledQty: number;
  originalOrderId: string;
};