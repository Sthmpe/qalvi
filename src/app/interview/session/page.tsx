import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import InterviewRoom from "@/components/interview/InterviewRoom";
import { RESUME_COOKIE } from "@/lib/interview/gateway";
import { readParticipantRecovery } from "@/lib/interview/recovery";
import { mergeCanonical, terminalInterview } from "@/components/interview/recovery";
import ClearInterviewDrafts from "@/components/interview/ClearInterviewDrafts";
import "../../(research)/research.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Qalvi: Interview",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ParticipantSessionPage() {
  const token = (await cookies()).get(RESUME_COOKIE)?.value;
  let session;
  try { session = await readParticipantRecovery(token); }
  catch { return <main className="participant-session-unavailable">
    <h1>Your saved conversation is temporarily unavailable.</h1>
    <p>Refresh this page to try again. Your draft stays in this tab.</p>
  </main>; }
  if (!session) return <main className="participant-session-unavailable">
    <ClearInterviewDrafts />
    <h1>This interview session is unavailable.</h1>
    <p>This session may have expired, or the conversation may have ended.</p>
    <Link href="/interview/demo">Explore the Qalvi demo</Link>
  </main>;
  let snapshot = session;
  while (snapshot.hasMore) {
    const page = await readParticipantRecovery(token, snapshot.nextCursor).catch(() => null);
    if (!page || page.nextCursor <= snapshot.nextCursor) return <main className="participant-session-unavailable">
      <h1>Your saved conversation is temporarily unavailable.</h1>
      <p>Refresh this page to try again. Your draft stays in this tab.</p>
    </main>;
    snapshot = { ...page, messages: mergeCanonical(snapshot.messages, page.messages) };
  }
  return <InterviewRoom tokenEndpoint="/interview/api/token" initialRecovery={snapshot}
    readOnly={terminalInterview(snapshot.status)} />;
}
