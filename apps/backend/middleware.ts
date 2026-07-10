
import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "db";

const supabase = createClient("https://pmnpnshcstoqxqkhcoip.supabase.co", process.env.SUPABASE_SECRET_KEY!);

export async function middleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Missing authorization header" });
    }

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(403).json({ message: "Incorrect credentials" });
    }

    const address: string | undefined = user?.user_metadata?.custom_claims?.address;

    if (address) {
      const userDb = await prisma.user.upsert({
        where: { address },
        update: { address },
        create: { address, usdBalance: 0 },
      });

      (req as any).userId = userDb.id;
      next();
    } else {
      return res.status(403).json({ message: "Incorrect credentials" });
    }
  } catch (e) {
    return res.status(500).json({ message: "Internal server error", error: String(e) });
  }
}