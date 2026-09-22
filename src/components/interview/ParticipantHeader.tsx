import Link from "next/link";

export default function ParticipantHeader({ preview = false }: { preview?: boolean }) {
  return (
    <header className="participant-header">
      <span className="participant-brand"><span className="brand-orb" aria-hidden="true" />Qalvi<span className="brand-period">.</span></span>
      {preview ? <Link href="/interview/demo">Back to interview ↗</Link> : <span className="participant-header-note">A conversation with Qalvi</span>}
    </header>
  );
}
