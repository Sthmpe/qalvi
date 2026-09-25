import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import InterviewRoom from "@/components/interview/InterviewRoom";
import { RESUME_COOKIE, resolveParticipant } from "@/lib/interview/gateway";
import "../../(research)/research.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Qalvi: Interview",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ParticipantSessionPage() {
  const token = (await cookies()).get(RESUME_COOKIE)?.value;
  const session = await resolveParticipant(token).catch(() => null);
  if (!session) return <main className="participant-session-unavailable">
    <h1>This interview session is unavailable.</h1>
    <p>This session may have expired, or the conversation may have ended.</p>
    <Link href="/interview/demo">Explore the Qalvi demo</Link>
  </main>;
  return <InterviewRoom tokenEndpoint="/interview/api/token" />;
}
