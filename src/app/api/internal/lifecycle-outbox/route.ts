import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { drainLifecycleOutbox } from "@/lib/interview/lifecycle";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Scheduler hook for ejection retries (for example a cron every minute). Only a
 * caller holding QALVI_INTERNAL_TASK_SECRET may drain the outbox. Without that
 * secret configured the route does not exist.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.QALVI_INTERNAL_TASK_SECRET;
  if (!secret || secret.length < 32) return new NextResponse(null, { status: 404 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!timingSafeEqual(digest(supplied), digest(secret))) return new NextResponse(null, { status: 404 });
  try {
    const result = await drainLifecycleOutbox({ limit: 25 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Lifecycle outbox is unavailable." }, { status: 503 });
  }
}
