"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { reviewFinding } from "@/lib/research/actions";

export default function FindingReview({ studyId, findingId, accepted }: { studyId: string; findingId: string; accepted: boolean }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const decide = (decision: "accepted" | "rejected") => startTransition(async () => {
    setFailed(!(await reviewFinding(studyId, findingId, decision)).ok);
  });
  return (
    <div className="finding-review">
      {!accepted && <Button variant="secondary" disabled={pending} onClick={() => decide("accepted")}>Accept finding</Button>}
      <Button variant="quiet" disabled={pending} onClick={() => decide("rejected")}>Dismiss</Button>
      {failed && <span role="alert" className="field-error">That did not save. Try again.</span>}
    </div>
  );
}
