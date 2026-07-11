import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export { getRequestContext, logDebug, logError, maskHeaders, runWithRequestContext } from "./logger";

const adapter = new PrismaPg({
  connectionString: process.env.POSTGRES_DATABASE_URL ?? process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({
  adapter,
  log: [{ emit: "event", level: "query" }, { emit: "event", level: "error" }, { emit: "event", level: "warn" }],
});

prisma.$on("query", (event) => {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "debug",
      layer: "database",
      requestId: undefined,
      query: event.query,
      params: event.params,
      durationMs: event.duration,
    }),
  );
});

prisma.$on("error", (event) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      layer: "database",
      message: event.message,
    }),
  );
});