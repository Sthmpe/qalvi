"use client";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  PageHeading,
  SectionHeading,
} from "@/components/ui/primitives";
import { templates } from "@/lib/research/mock-data";

export default function StudyDraft({ templateId }: { templateId?: string }) {
  const initial =
    templates.find((item) => item.id === templateId) ?? templates[0];
  const [template, setTemplate] = useState(initial.id);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState(initial.goal);
  const [audience, setAudience] = useState("");
  const [preview, setPreview] = useState(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);
  return (
    <>
      <PageHeading
        eyebrow="A GOOD STUDY STARTS WITH A QUESTION"
        title="What are you curious about?"
        description="Shape a research brief. This preview stays on this page and does not create a study."
      />
      <div className="draft-layout">
        <form
          className="q-card draft-form"
          onSubmit={(event) => {
            event.preventDefault();
            setPreview(true);
          }}
        >
          <SectionHeading title="Give your research direction" />
          <label>
            Starting point
            <select
              value={template}
              onChange={(event) => {
                const next = templates.find(
                  (item) => item.id === event.target.value,
                )!;
                setTemplate(next.id);
                setGoal(next.goal);
                setPreview(false);
              }}
            >
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Study name
            <input
              required
              maxLength={120}
              placeholder="e.g. Understanding our customers’ first week"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setPreview(false);
              }}
            />
          </label>
          <label>
            What do you want to learn?
            <textarea
              required
              maxLength={1200}
              rows={4}
              value={goal}
              onChange={(event) => {
                setGoal(event.target.value);
                setPreview(false);
              }}
            />
          </label>
          <label>
            Who would you like to hear from?
            <input
              required
              maxLength={200}
              placeholder="e.g. Customers who joined in the last month"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value);
                setPreview(false);
              }}
            />
          </label>
          <Button type="submit">
            Preview research brief <span aria-hidden="true">→</span>
          </Button>
          <p className="quiet-note">
            Nothing is saved or sent. Reloading clears this brief.
          </p>
        </form>
        <div className="draft-aside">
          {preview ? (
            <Card className="brief-preview">
              <Badge tone="indigo">Unsaved research brief</Badge>
              <h2 ref={previewHeading} tabIndex={-1}>{title}</h2>
              <h3>Research goal</h3>
              <p>{goal}</p>
              <h3>Participants</h3>
              <p>{audience}</p>
              <p role="status" className="quiet-note">
                Brief preview ready. Study creation is not connected yet.
              </p>
            </Card>
          ) : (
            <Card className="brief-guidance">
              <span className="q-eyebrow">A LITTLE GUIDANCE</span>
              <h2>
                Stay curious.
                <br />
                Leave room to be surprised.
              </h2>
              <p>
                Start with a decision you need to make. Ask about real
                experiences before exploring possibilities.
              </p>
              <hr />
              <h3>Keep the original words.</h3>
              <p>
                A finding should always lead back to the conversation that
                supports it.
              </p>
            </Card>
          )}
          <ButtonLink href="/studies/everyday-work" variant="quiet">
            Explore a sample study →
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
