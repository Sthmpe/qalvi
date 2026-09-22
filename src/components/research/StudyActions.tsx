"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/primitives";

export default function StudyActions({ studyId }: { studyId: string }) {
  const [feedback, setFeedback] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyLink() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/interview/${studyId}`,
      );
      setFeedback(
        "Participant preview link copied. This study is sample data.",
      );
    } catch {
      setCopyFailed(true);
      setFeedback(
        "Copy isn't available here. Open the participant preview below and copy its address.",
      );
    }
  }
  return (
    <div className="study-actions">
      <div className="button-row">
        <Button variant="secondary" onClick={() => void copyLink()}>
          Copy participant link
        </Button>
        <ButtonLink href="/interview/demo">
          Test interview <span aria-hidden="true">↗</span>
        </ButtonLink>
      </div>
      <p className="action-feedback" role="status">
        {feedback ||
          "Test interview opens the general live demo. Sample studies are previews."}
        {copyFailed && (
          <>
            {" "}
            <Link className="text-link" href={`/interview/${studyId}`}>
              Open participant preview ↗
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
