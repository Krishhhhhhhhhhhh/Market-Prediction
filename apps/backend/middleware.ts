
import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://pmnpnshcstoqxqkhcoip.supabase.co", process.env.SUPABASE_SECRET_KEY!);

export async function middleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Missing authorization header" });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(403).json({ message: "Incorrect credentials" });
  }

  next();
}