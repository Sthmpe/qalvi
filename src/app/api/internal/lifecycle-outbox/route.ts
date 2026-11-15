import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { drainLifecycleOutbox } from "@/lib/interview/lifecycle";

const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(request: NextRequest, secret: string | undefined, minimumLength: number) {
  if (!secret || secret.length < minimumLength) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return timingSafeEqual(digest(supplied), digest(secret));
}

async function drain() {
  try {
    const result = await drainLifecycleOutbox({ limit: 25 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Lifecycle outbox is unavailable." }, { status: 503 });
  }
}

/**
 * Scheduler hook for ejection retries. Only a caller holding
 * QALVI_INTERNAL_TASK_SECRET may drain the outbox. Without that secret
 * configured the route does not exist.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request, process.env.QALVI_INTERNAL_TASK_SECRET, 32)) return new NextResponse(null, { status: 404 });
  return drain();
}

/**
 * Vercel Cron invokes GET and sends "Authorization: Bearer $CRON_SECRET". This
 * adapter accepts only that header, never a query string, and leaves the POST
 * contract unchanged. Draining is idempotent: rows are leased, retried with
 * backoff and settled in the database, so overlapping runs are safe.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request, process.env.CRON_SECRET, 16)) return new NextResponse(null, { status: 404 });
  return drain();
}
