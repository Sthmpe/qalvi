"use client";

import { useState } from "react";
import ParticipantHeader from "./ParticipantHeader";
import "./participant.css";
import VisualStage from "./VisualStage";
import { demoVisuals } from "./visuals/demoVisuals";
import { describeResponse, type VisualResponse } from "./visuals/display";

/** Deterministic preview of the four interview visuals. Answers stay on this page. */
export default function VisualGallery() {
  const [responses, setResponses] = useState<Record<string, VisualResponse>>({});
  const [revision, setRevision] = useState(0);

  return (
    <div className="participant-room visual-gallery">
      <ParticipantHeader preview />
      <main className="gallery-main">
        <div className="gallery-intro">
          <p className="participant-eyebrow">VISUAL PREVIEW</p>
          <h1>A conversation can take shape.</h1>
          <p>Compare possibilities, explore a value, or share what fits. In an interview, Qalvi introduces these visuals alongside the conversation.</p>
          <div className="gallery-note"><span>This gallery is for previewing all four types. Answers stay on this page.</span>
            <button type="button" onClick={() => { setResponses({}); setRevision((value) => value + 1); }}>Reset answers</button>
          </div>
        </div>
        <div className="gallery-grid">
        {demoVisuals.map((action) => {
          const response = responses[action.id] ?? null;
          const summary = response ? describeResponse(action, response) : null;
          return (
            <div key={`${revision}-${action.id}`} className="gallery-example">
              <VisualStage
                preview
                action={action}
                response={response}
                busy={false}
                onRespond={(next) => setResponses((previous) => ({ ...previous, [action.id]: next }))}
              />
              {summary && (
                <p className="gallery-answer">
                  Your answer: <span>{summary}</span>
                </p>
              )}
            </div>
          );
        })}
        </div>
      </main>
    </div>
  );
}
