
import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { logError, prisma } from "db";

const supabase = createClient("https://pmnpnshcstoqxqkhcoip.supabase.co", process.env.SUPABASE_SECRET_KEY!);

export async function middleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logError("middleware.auth.failed", { reason: "Missing Authorization header" });
      return res.status(401).json({ message: "Missing authorization header" });
    }

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logError("middleware.auth.failed", {
        reason: "Supabase auth.getUser returned error or no user",
        errorMessage: error?.message,
        errorName: error?.name,
        errorStatus: (error as { status?: number } | undefined)?.status,
      });
      return res.status(403).json({ message: "Incorrect credentials", debug: error?.message });
    }

    const provider = user?.app_metadata?.provider;
    const isDemoAccount = provider === "google";
    const address: string | undefined = isDemoAccount
      ? `google:${user.id}`
      : user?.user_metadata?.custom_claims?.address ??
        user?.email ??
        user?.id;

    if (address) {
      const userDb = await prisma.user.upsert({
        where: { address },
        update: { address, kind: isDemoAccount ? "DEMO" : "REAL" },
        create: {
          address,
          kind: isDemoAccount ? "DEMO" : "REAL",
          usdBalance: isDemoAccount ? 100000 : 0,
        },
      });

      (req as any).userId = userDb.id;
      next();
    } else {
      logError("middleware.auth.failed", { reason: "Resolved user had no mappable address" });
      return res.status(403).json({ message: "Incorrect credentials" });
    }
  } catch (e) {
    logError("middleware.auth.exception", { errorMessage: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    return res.status(500).json({ message: "Internal server error", error: String(e) });
  }
}