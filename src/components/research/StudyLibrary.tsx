"use client";
import { useState } from "react";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeading,
} from "@/components/ui/primitives";
import { studies } from "@/lib/research/mock-data";
import StudyCard from "./StudyCard";

export default function StudyLibrary() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All studies");
  const filtered = studies.filter(
    (study) =>
      (status === "All studies" || study.status === status) &&
      `${study.title} ${study.category} ${study.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESEARCH LIBRARY"
        title="Questions worth exploring."
        description="A home for every study, from the first question to the original evidence."
        action={<ButtonLink href="/studies/new">＋ Create study</ButtonLink>}
      />
      <div className="library-toolbar">
        <div className="filter-group" aria-label="Filter studies">
          {["All studies", "Active", "Draft", "Completed"].map((value) => (
            <button
              key={value}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {value}
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
        {filtered.length} sample {filtered.length === 1 ? "study" : "studies"}
      </p>
      <div className="study-grid">
        {filtered.map((study) => (
          <StudyCard key={study.id} study={study} />
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="No studies match just yet"
          description="Try another phrase or clear the filters to explore the sample studies."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setStatus("All studies");
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}
    </>
  );
}
