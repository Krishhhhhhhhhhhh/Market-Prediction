-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('REAL', 'DEMO');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kind" "AccountKind" NOT NULL DEFAULT 'REAL';
