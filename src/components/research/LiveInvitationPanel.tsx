"use client";

import { useState } from "react";

type StudyOption = { id: string; title: string };

export default function LiveInvitationPanel({ studies }: { studies: StudyOption[] }) {
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createInvitation() {
    setBusy(true);
    setError("");
    setUrl("");
    try {
      const response = await fetch(`/api/studies/${studyId}/invitations`, { method: "POST" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Invitation could not be created.");
      setUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invitation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="live-invitation-panel" aria-labelledby="live-invitation-title">
    <div>
      <p className="q-eyebrow">LIVE STUDY ACCESS</p>
      <h2 id="live-invitation-title">Invite a participant</h2>
      <p>Create one private link for one participant. It expires after seven days.</p>
    </div>
    {studies.length ? <div className="live-invitation-form">
      <label htmlFor="live-study">Active study</label>
      <select id="live-study" value={studyId} onChange={(event) => { setStudyId(event.target.value); setUrl(""); }}>
        {studies.map((study) => <option key={study.id} value={study.id}>{study.title}</option>)}
      </select>
      <button type="button" className="q-button q-button--primary" disabled={busy} onClick={() => void createInvitation()}>
        {busy ? "Creating link…" : "Create private link"}
      </button>
    </div> : <p className="quiet-note">No active connected study is available yet. The sample studies above are previews.</p>}
    {url && <div className="live-invitation-result" role="status">
      <p>Copy this link now. It is shown only once.</p>
      <input aria-label="New participant invitation link" readOnly value={url} onFocus={(event) => event.target.select()} />
      <button type="button" className="q-button q-button--secondary" onClick={() => void navigator.clipboard.writeText(url).catch(() => setError("Copy failed. Select the link above to copy it."))}>Copy link</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
