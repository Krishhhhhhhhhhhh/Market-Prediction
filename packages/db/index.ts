import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.POSTGRES_DATABASE_URL ?? process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({
  adapter,
});