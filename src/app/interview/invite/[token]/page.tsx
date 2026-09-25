import type { Metadata } from "next";
import { previewInvitation } from "@/lib/interview/gateway";
import { QalviOrb } from "@/components/ui/primitives";
import "../../../(research)/research.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Qalvi: Conversation invitation",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const study = await previewInvitation(token).catch(() => null);
  return <div className="participant-preview">
    <header><span className="q-brand"><QalviOrb />Qalvi</span><span>Conversation invitation</span></header>
    <main>
      <QalviOrb size="large" />
      <p className="q-eyebrow">YOUR PERSPECTIVE MATTERS</p>
      <h1>{study?.title ?? "This invitation is unavailable"}</h1>
      {study && <p>{study.description || "Share your perspective in a private research conversation."}</p>}
      <div className="invitation-details"><span>Voice or text</span><span>No camera</span></div>
      {study ? <form method="post" action="/interview/api/claim">
        <input type="hidden" name="invitation" value={token} />
        <label className="invitation-consent">
          <input type="checkbox" name="consent" value="yes" required />
          <span>I agree to Qalvi storing a transcript of this conversation for the research study. Audio is not stored.</span>
        </label>
        <button className="q-button q-button--primary" type="submit">Start interview</button>
      </form> : <p role="alert">This link has expired, was already used, or is no longer available.</p>}
      <p className="quiet-note">Your conversation begins only when you choose to start.</p>
    </main>
  </div>;
}
