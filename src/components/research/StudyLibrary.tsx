"use client";
import { useState } from "react";
import { Button, ButtonLink, EmptyState, PageHeading } from "@/components/ui/primitives";
import { STATUS_LABEL, type StudyStatus } from "@/lib/studies/setup";
import type { StudySummary } from "@/lib/studies/queries";
import StudyCard from "./StudyCard";

const FILTERS: (StudyStatus | "all")[] = ["all", "active", "draft", "completed"];

export default function StudyLibrary({ studies }: { studies: StudySummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StudyStatus | "all">("all");
  const filtered = studies.filter(
    (study) =>
      (status === "all" || study.status === status) &&
      `${study.title} ${study.category} ${study.description} ${study.researchGoal}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const heading = (
    <PageHeading
      eyebrow="YOUR RESEARCH LIBRARY"
      title="Questions worth exploring."
      description="A home for every study, from the first question to the original evidence."
      action={<ButtonLink href="/studies/new">＋ Create study</ButtonLink>}
    />
  );
  if (!studies.length) {
    return (
      <>
        {heading}
        <EmptyState
          title="Your first study starts with a question"
          description="Describe what you want to learn and who you want to hear from. Qalvi will follow it in every conversation."
          action={<ButtonLink href="/studies/new">Create a study</ButtonLink>}
        />
      </>
    );
  }
  return (
    <>
      {heading}
      <div className="library-toolbar">
        <div className="filter-group" aria-label="Filter studies">
          {FILTERS.map((value) => (
            <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {value === "all" ? "All studies" : STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <label className="search-field">
          <span className="sr-only">Search studies</span>
          <input
            type="search"
            placeholder="Search studies…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <p className="results-count" role="status">
        {filtered.length} {filtered.length === 1 ? "study" : "studies"}
      </p>
      <div className="study-grid">
        {filtered.map((study) => (
          <StudyCard key={study.id} study={study} />
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="No studies match just yet"
          description="Try another phrase or clear the filters."
          action={
            <Button variant="secondary" onClick={() => { setQuery(""); setStatus("all"); }}>
              Clear filters
            </Button>
          }
        />
      )}
    </>
  );
}
