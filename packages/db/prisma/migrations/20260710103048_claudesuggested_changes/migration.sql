-- AlterTable
ALTER TABLE "Market" ALTER COLUMN "totalQty" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderHistory" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "usdBalance" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "OrderHistory_marketId_idx" ON "OrderHistory"("marketId");

-- CreateIndex
CREATE INDEX "Position_marketId_idx" ON "Position"("marketId");
