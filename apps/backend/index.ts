import express from "express";
import cors from "cors";
import crypto from "crypto";
import { middleware } from "./middleware";
import { prisma } from "db";
import { TradeSchema, SplitMergeSchema, OnrampSchema, OfframpSchema, type BookOrder } from "./types";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

class AppError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

const app = express();
app.use(express.json());
app.use(cors());

// $1 = 100 cents. A split mints 1 YES + 1 NO share per pair; a merge
// burns 1 YES + 1 NO share per pair and pays out $1 per pair. All
// balances/prices in the DB are stored as integer cents.
const PRICE_SCALE = 100;

function parseBook(raw: unknown): BookOrder[] {
  if (Array.isArray(raw)) return raw as BookOrder[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function executeTrade(req: express.Request, res: express.Response, type: "buy" | "sell") {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  const { success, data } = TradeSchema.safeParse(req.body);
  if (!success) return res.status(400).json({ message: "Invalid input" });

  const originalOrderId = crypto.randomUUID();
  const positionType = data.side === "yes" ? "YES" : "NO";

  try {
    await prisma.$transaction(async (tx) => {
      const [market] = await tx.$queryRaw<{ id: string; yesOrderbook: unknown; noOrderbook: unknown }[]>`
        SELECT id, "yesOrderbook", "noOrderbook" FROM "Market" WHERE id = ${data.marketId} FOR UPDATE
      `;
      if (!market) throw new AppError("Market not found", 404);

      const [user] = await tx.$queryRaw<{ id: string; usdBalance: number }[]>`
        SELECT id, "usdBalance" FROM "User" WHERE id = ${req.userId} FOR UPDATE
      `;
      if (!user) throw new AppError("User not found", 404);

      let book = parseBook(data.side === "yes" ? market.yesOrderbook : market.noOrderbook);
      let leftQty = data.qty;

      if (type === "buy") {
        const reserve = data.qty * data.price;
        if (user.usdBalance < reserve) throw new AppError("Insufficient balance", 400);
        await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { decrement: reserve } } });

        const asks = book
          .filter((o) => o.type === "sell" && o.price <= data.price)
          .sort((a, b) => a.price - b.price);

        for (const ask of asks) {
          if (leftQty <= 0) break;
          const matchedQty = Math.min(ask.qty - ask.filledQty, leftQty);
          if (matchedQty <= 0) continue;

          const tradeCost = matchedQty * ask.price;
          const refund = matchedQty * (data.price - ask.price); // price improvement goes to the taker

          if (refund > 0) {
            await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { increment: refund } } });
          }
          await tx.user.update({ where: { id: ask.userId }, data: { usdBalance: { increment: tradeCost } } });

          await tx.position.upsert({
            where: { userId_marketId_type: { userId: req.userId, marketId: data.marketId, type: positionType } },
            create: { userId: req.userId, marketId: data.marketId, type: positionType, qty: matchedQty },
            update: { qty: { increment: matchedQty } },
          });

          await tx.orderHistory.create({
            data: { id: crypto.randomUUID(), orderType: "BUY", qty: matchedQty, price: ask.price, userId: req.userId, marketId: data.marketId },
          });
          await tx.orderHistory.create({
            data: { id: crypto.randomUUID(), orderType: "SELL", qty: matchedQty, price: ask.price, userId: ask.userId, marketId: data.marketId },
          });

          ask.filledQty += matchedQty;
          leftQty -= matchedQty;
        }

        book = book.filter((o) => !(o.type === "sell" && o.filledQty >= o.qty));
        if (leftQty > 0) {
          book.push({ userId: req.userId, type: "buy", price: data.price, qty: leftQty, filledQty: 0, originalOrderId });
        }
      } else {
        // Lock the seller's position row too, not just read it — otherwise
        // two concurrent sells could both pass the balance check.
        const [positionLock] = await tx.$queryRaw<{ qty: number }[]>`
          SELECT "qty" FROM "Position"
          WHERE "userId" = ${req.userId} AND "marketId" = ${data.marketId} AND "type" = ${positionType}::"PositionType"
          FOR UPDATE
        `;
        if (!positionLock || positionLock.qty < data.qty) throw new AppError("Insufficient position", 400);

        await tx.position.update({
          where: { userId_marketId_type: { userId: req.userId, marketId: data.marketId, type: positionType } },
          data: { qty: { decrement: data.qty } },
        });

        const bids = book
          .filter((o) => o.type === "buy" && o.price >= data.price)
          .sort((a, b) => b.price - a.price);

        for (const bid of bids) {
          if (leftQty <= 0) break;
          const matchedQty = Math.min(bid.qty - bid.filledQty, leftQty);
          if (matchedQty <= 0) continue;

          const tradeCost = matchedQty * bid.price; // executes at the maker's (higher) price — seller benefits

          await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { increment: tradeCost } } });

          await tx.position.upsert({
            where: { userId_marketId_type: { userId: bid.userId, marketId: data.marketId, type: positionType } },
            create: { userId: bid.userId, marketId: data.marketId, type: positionType, qty: matchedQty },
            update: { qty: { increment: matchedQty } },
          });

          await tx.orderHistory.create({
            data: { id: crypto.randomUUID(), orderType: "SELL", qty: matchedQty, price: bid.price, userId: req.userId, marketId: data.marketId },
          });
          await tx.orderHistory.create({
            data: { id: crypto.randomUUID(), orderType: "BUY", qty: matchedQty, price: bid.price, userId: bid.userId, marketId: data.marketId },
          });

          bid.filledQty += matchedQty;
          leftQty -= matchedQty;
        }

        book = book.filter((o) => !(o.type === "buy" && o.filledQty >= o.qty));
        if (leftQty > 0) {
          book.push({ userId: req.userId, type: "sell", price: data.price, qty: leftQty, filledQty: 0, originalOrderId });
        }
      }

      const filledQty = data.qty - leftQty;
      await tx.market.update({
        where: { id: data.marketId },
        data: {
          ...(data.side === "yes" ? { yesOrderbook: book } : { noOrderbook: book }),
          totalQty: { increment: filledQty },
        },
      });
    });

    return res.json({ message: "Order executed", orderId: originalOrderId });
  } catch (e) {
    if (e instanceof AppError) return res.status(e.statusCode).json({ message: e.message });
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
}

app.post("/buy", middleware, (req, res) => executeTrade(req, res, "buy"));
app.post("/sell", middleware, (req, res) => executeTrade(req, res, "sell"));

app.post("/split", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const { success, data } = SplitMergeSchema.safeParse(req.body);
  if (!success) return res.status(400).json({ message: "Invalid input" });

  try {
    await prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<{ id: string; usdBalance: number }[]>`
        SELECT id, "usdBalance" FROM "User" WHERE id = ${req.userId} FOR UPDATE
      `;
      if (!user) throw new AppError("User not found", 404);

      const cost = data.qty * PRICE_SCALE;
      if (user.usdBalance < cost) throw new AppError("Insufficient balance", 400);

      await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { decrement: cost } } });

      for (const t of ["YES", "NO"] as const) {
        await tx.position.upsert({
          where: { userId_marketId_type: { userId: req.userId, marketId: data.marketId, type: t } },
          create: { userId: req.userId, marketId: data.marketId, type: t, qty: data.qty },
          update: { qty: { increment: data.qty } },
        });
      }

      await tx.orderHistory.create({
        data: { id: crypto.randomUUID(), orderType: "SPLIT", qty: data.qty, price: PRICE_SCALE, userId: req.userId, marketId: data.marketId },
      });
    });

    return res.json({ message: "Split successful" });
  } catch (e) {
    if (e instanceof AppError) return res.status(e.statusCode).json({ message: e.message });
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/merge", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const { success, data } = SplitMergeSchema.safeParse(req.body);
  if (!success) return res.status(400).json({ message: "Invalid input" });

  try {
    await prisma.$transaction(async (tx) => {
      const [yesPos] = await tx.$queryRaw<{ qty: number }[]>`
        SELECT "qty" FROM "Position" WHERE "userId" = ${req.userId} AND "marketId" = ${data.marketId} AND "type" = 'YES' FOR UPDATE
      `;
      const [noPos] = await tx.$queryRaw<{ qty: number }[]>`
        SELECT "qty" FROM "Position" WHERE "userId" = ${req.userId} AND "marketId" = ${data.marketId} AND "type" = 'NO' FOR UPDATE
      `;

      if (!yesPos || yesPos.qty < data.qty) throw new AppError("Insufficient YES position", 400);
      if (!noPos || noPos.qty < data.qty) throw new AppError("Insufficient NO position", 400);

      await tx.position.update({
        where: { userId_marketId_type: { userId: req.userId, marketId: data.marketId, type: "YES" } },
        data: { qty: { decrement: data.qty } },
      });
      await tx.position.update({
        where: { userId_marketId_type: { userId: req.userId, marketId: data.marketId, type: "NO" } },
        data: { qty: { decrement: data.qty } },
      });

      const payout = data.qty * PRICE_SCALE;
      await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { increment: payout } } });

      await tx.orderHistory.create({
        data: { id: crypto.randomUUID(), orderType: "MERGE", qty: data.qty, price: PRICE_SCALE, userId: req.userId, marketId: data.marketId },
      });
    });

    return res.json({ message: "Merge successful" });
  } catch (e) {
    if (e instanceof AppError) return res.status(e.statusCode).json({ message: e.message });
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/onramp", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const { success, data } = OnrampSchema.safeParse(req.body);
  if (!success) return res.status(400).json({ message: "Invalid input" });

  const amountInCents = Math.round(data.amount * 100);

  try {
    await prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE id = ${req.userId} FOR UPDATE
      `;
      if (!user) throw new AppError("User not found", 404);

      await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { increment: amountInCents } } });
    });

    return res.json({ message: "Onramp successful", amount: data.amount });
  } catch (e) {
    if (e instanceof AppError) return res.status(e.statusCode).json({ message: e.message });
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/offramp", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const { success, data } = OfframpSchema.safeParse(req.body);
  if (!success) return res.status(400).json({ message: "Invalid input" });

  const amountInCents = Math.round(data.amount * 100);

  try {
    await prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<{ id: string; usdBalance: number }[]>`
        SELECT id, "usdBalance" FROM "User" WHERE id = ${req.userId} FOR UPDATE
      `;
      if (!user) throw new AppError("User not found", 404);
      if (user.usdBalance < amountInCents) throw new AppError("Insufficient balance", 400);

      await tx.user.update({ where: { id: req.userId }, data: { usdBalance: { decrement: amountInCents } } });
    });

    return res.json({ message: "Offramp successful", amount: data.amount });
  } catch (e) {
    if (e instanceof AppError) return res.status(e.statusCode).json({ message: e.message });
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/markets", async (_req, res) => {
  const markets = await prisma.market.findMany();
  return res.json({ markets });
});

app.get("/balance", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ balance: user.usdBalance });
});

app.get("/positions", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const positions = await prisma.position.findMany({ where: { userId: req.userId } });
  return res.json({ positions });
});

app.get("/history", middleware, async (req, res) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const history = await prisma.orderHistory.findMany({ where: { userId: req.userId } });
  return res.json({ history });
});

app.listen(3000, () => console.log("Server running on port 3000"));