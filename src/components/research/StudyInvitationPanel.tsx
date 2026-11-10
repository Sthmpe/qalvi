"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * One private link for one participant, issued by the existing invitation
 * gateway: the server checks membership through RLS, accepts only an active
 * study, stores only a hash, and returns the plaintext link once.
 */
export default function StudyInvitationPanel({ studyId, active, gaps }: {
  studyId: string; active: boolean; gaps: string[];
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createInvitation() {
    setBusy(true);
    setError("");
    setUrl("");
    setCopied(false);
    try {
      const response = await fetch(`/api/studies/${studyId}/invitations`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "The link could not be created.");
      setUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The link could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Copy isn’t available here. Select the link above to copy it.");
    }
  }

  return <section className="live-invitation-panel" aria-labelledby="study-invitation-title">
    <div>
      <p className="q-eyebrow">PARTICIPANT LINK</p>
      <h2 id="study-invitation-title">Invite a participant</h2>
      <p>
        Each private link admits one person and expires after seven days. Qalvi will follow this
        study’s goal and objectives in their conversation.
      </p>
    </div>
    {active ? <div className="live-invitation-form">
      <button type="button" className="q-button q-button--primary" disabled={busy} onClick={() => void createInvitation()}>
        {busy ? "Creating link…" : url ? "Create another link" : "Create private link"}
      </button>
    </div> : <p className="quiet-note">
      {gaps.length
        ? `To invite participants, add ${gaps.join(", ")}, then make the study active. `
        : "Make the study active to invite participants. "}
      <Link href={`/studies/${studyId}/settings`}>Open setup →</Link>
    </p>}
    {url && <div className="live-invitation-result" role="status">
      <p>Copy this link now. It is shown only once, and only one person can use it.</p>
      <input aria-label="New participant link" readOnly value={url} onFocus={(event) => event.target.select()} />
      <button type="button" className="q-button q-button--secondary" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </section>;
}
