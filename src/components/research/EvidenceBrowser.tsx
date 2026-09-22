"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  SectionHeading,
} from "@/components/ui/primitives";
import { getParticipant, studyConversations, studyFindings } from "@/lib/research/mock-data";

export default function EvidenceBrowser({
  studyId,
  selectedId,
}: {
  studyId: string;
  selectedId?: string;
}) {
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState("all");
  const interviews = studyConversations(studyId);
  const selected = selectedId
    ? interviews.find((item) => item.id === selectedId)
    : interviews[0];
  const messages =
    selected?.messages.filter(
      (message) =>
        (speaker === "all" || speaker === message.speaker) &&
        message.text.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  if (selectedId && !selected)
    return (
      <EmptyState
        title="Conversation not found"
        description="This conversation does not belong to this sample study. Choose an available interview to read its original messages."
        action={<ButtonLink href={`/studies/${studyId}/interviews`}>View study interviews</ButtonLink>}
      />
    );
  if (!selected)
    return (
      <EmptyState
        title="No conversations yet"
        description="Original participant messages will live here. This sample study has no interview evidence."
      />
    );
  return (
    <>
      <SectionHeading
        title="Original words, before interpretations"
        description="Sample transcript excerpts. These are illustrative messages, not collected research."
      />
      <div className="evidence-browser">
        <aside className="conversation-picker">
          <p className="q-eyebrow">CONVERSATIONS · {interviews.length}</p>
          {interviews.map((conversation) => (
            <Link
              key={conversation.id}
              className={selected.id === conversation.id ? "selected" : ""}
              aria-current={
                selected.id === conversation.id ? "page" : undefined
              }
              href={`/studies/${studyId}/interviews?conversation=${conversation.id}`}
            >
              <strong>{getParticipant(conversation.participantId).name}</strong>
              <span>
                {conversation.date} · {conversation.mode}
              </span>
            </Link>
          ))}
        </aside>
        <Card className="evidence-panel">
          <div className="evidence-header">
            <div>
              <h2>{getParticipant(selected.participantId).name}</h2>
              <p>{getParticipant(selected.participantId).role}</p>
              <p>{selected.date} · {selected.mode} conversation · {selected.duration}</p>
            </div>
            <Badge>Raw evidence · sample</Badge>
          </div>
          <div className="evidence-toolbar">
            <label>
              <span className="sr-only">Search original messages</span>
              <input
                type="search"
                placeholder="Search original messages…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Filter by speaker</span>
              <select
                value={speaker}
                onChange={(event) => setSpeaker(event.target.value)}
              >
                <option value="all">All speakers</option>
                <option value="participant">Participant only</option>
                <option value="interviewer">Qalvi only</option>
              </select>
            </label>
          </div>
          <p className="results-count" role="status">
            {messages.length} of {selected.messages.length} sample messages
          </p>
          <div className="evidence-messages">
            {messages.map((message) => (
              <article
                key={message.id}
                id={message.id}
                className={`evidence-message ${message.speaker}`}
              >
                <div>
                  <strong>
                    {message.speaker === "participant"
                      ? getParticipant(selected.participantId).name
                      : "Qalvi"}
                  </strong>
                  <span>{message.time}</span>
                </div>
                <p>{message.text}</p>
                {studyFindings(studyId).filter((finding) =>
                  finding.sources.some((source) => source.conversationId === selected.id && source.messageId === message.id),
                ).map((finding) => (
                  <Link key={finding.id} className="evidence-finding-link text-link"
                    href={`/studies/${studyId}/findings#${finding.id}`}>
                    Referenced in: {finding.title} <span aria-hidden="true">↗</span>
                  </Link>
                ))}
              </article>
            ))}
            {!messages.length && (
              <div className="inline-empty">
                <p>No messages match these filters.</p>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setQuery("");
                    setSpeaker("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          <p className="evidence-footnote">
            Original messages are separate from derived findings. Sample
            excerpts are not a complete interview record.
          </p>
        </Card>
      </div>
    </>
  );
}
