import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudy } from "@/lib/research/mock-data";
import { QalviOrb } from "@/components/ui/primitives";
import "../../(research)/research.css";
export const metadata = { title: "Qalvi — Conversation invitation" };
export default async function ParticipantPreview({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const study = getStudy((await params).studyId);
  if (!study) notFound();
  return (
    <div className="participant-preview">
      <header>
        <Link href="/dashboard" className="q-brand">
          <QalviOrb />
          Qalvi
        </Link>
        <span>Conversation invitation</span>
      </header>
      <main>
        <QalviOrb size="large" />
        <p className="q-eyebrow">YOUR PERSPECTIVE MATTERS</p>
        <h1>{study.title}</h1>
        <p>{study.description}</p>
        <div className="invitation-details">
          <span>7–12 minutes</span>
          <span>Voice or text</span>
          <span>No camera</span>
        </div>
        <div className="invitation-notice">
          <strong>Sample invitation</strong>
          <p>
            Explore the interview experience with a general AI conversation.
            The demo will not ask questions specific to this study, and your
            conversation will not be saved to the research workspace.
          </p>
        </div>
        <Link className="q-button q-button--primary" href="/interview/demo">
          Try the live demo →
        </Link>
        <p className="quiet-note">
          Your conversation begins only when you choose to start. Speak or type,
          and switch at any time.
        </p>
      </main>
    </div>
  );
}
