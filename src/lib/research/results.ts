import "server-only";
import { cache } from "react";
import { getResearcher } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseDisplayAction, type DisplayAction } from "@/components/interview/visuals/display";
import { FINDING_CATEGORIES, readCoverage, type FindingCategory, type ObjectiveCoverage } from "./analysisShape";

// Everything here is read through the signed-in researcher's row level security
// session. Another workspace's interviews simply do not appear.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InterviewStatus = "pending" | "in_progress" | "interrupted" | "completed" | "cancelled" | "failed";
export type InterviewSummary = {
  id: string; participant: string; status: InterviewStatus; startedAt: string; endedAt: string | null;
  messages: number; analysis: "processing" | "completed" | "failed" | null;
};
export type TranscriptMessage = {
  id: string; sequence: number; speaker: "participant" | "interviewer"; channel: "voice" | "text" | "visual";
  content: string; occurredAt: string; interrupted: boolean;
};
export type ShownVisual = { id: string; action: DisplayAction; issuedAt: string; answerMessageId: string | null };
export type InterviewAnalysis = {
  status: "processing" | "completed" | "failed"; summary: string; error: string | null;
  coverage: ObjectiveCoverage[]; completedAt: string | null;
};
export type InterviewDetail = InterviewSummary & {
  transcript: TranscriptMessage[]; visuals: ShownVisual[]; detail: InterviewAnalysis | null;
};
export type EvidenceQuote = {
  messageId: string; conversationId: string; participant: string; speaker: "participant" | "interviewer";
  content: string; relation: "supports" | "contradicts";
};
export type FindingRecord = {
  id: string; title: string; summary: string; category: FindingCategory; origin: "ai" | "researcher";
  status: "proposed" | "accepted" | "rejected"; evidence: EvidenceQuote[];
};

const alias = (value: string | undefined, index: number) =>
  // Stored aliases are "Participant <uuid>"; researchers see a short stable label.
  (value && !/^Participant [0-9a-f-]{36}$/i.test(value) ? value : `Participant ${String(index + 1).padStart(2, "0")}`);
const status = (value: string): InterviewStatus =>
  (["pending", "in_progress", "interrupted", "completed", "cancelled", "failed"] as const).find((item) => item === value) ?? "pending";
const analysisStatus = (value: string | undefined): InterviewSummary["analysis"] =>
  (value === "processing" || value === "completed" || value === "failed" ? value : null);

export const listInterviews = cache(async (studyId: string): Promise<InterviewSummary[]> => {
  if (!UUID.test(studyId) || !(await getResearcher())) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("conversations")
    .select("id, status, started_at, ended_at, participants (alias), messages (count), conversation_analyses (status)")
    .eq("study_id", studyId).order("started_at", { ascending: true });
  if (error) throw new Error("Interviews could not be loaded.");
  return (data ?? []).map((row, index) => ({
    id: row.id, participant: alias(row.participants?.alias, index), status: status(row.status),
    startedAt: row.started_at, endedAt: row.ended_at, messages: row.messages?.[0]?.count ?? 0,
    analysis: analysisStatus(row.conversation_analyses?.[0]?.status),
  })).reverse();
});

export const getInterview = cache(async (studyId: string, conversationId: string): Promise<InterviewDetail | null> => {
  if (!UUID.test(conversationId)) return null;
  const summary = (await listInterviews(studyId)).find((item) => item.id === conversationId);
  if (!summary) return null;
  const supabase = await createSupabaseServerClient();
  const [messages, displays, responses, analysis] = await Promise.all([
    supabase.from("messages").select("id, sequence, speaker, channel, content, occurred_at, interrupted")
      .eq("conversation_id", conversationId).order("sequence"),
    supabase.from("visual_displays").select("id, definition, issued_at").eq("conversation_id", conversationId).order("issued_at"),
    supabase.from("visual_responses").select("display_id, message_id").eq("conversation_id", conversationId),
    supabase.from("conversation_analyses").select("status, summary, error, objective_coverage, completed_at")
      .eq("conversation_id", conversationId).maybeSingle(),
  ]);
  if (messages.error || displays.error || responses.error || analysis.error) throw new Error("This interview could not be loaded.");
  const answered = new Map((responses.data ?? []).map((row) => [row.display_id, row.message_id]));
  const detailStatus = analysisStatus(analysis.data?.status);
  return {
    ...summary,
    transcript: (messages.data ?? []).map((row) => ({
      id: row.id, sequence: row.sequence, speaker: row.speaker === "participant" ? "participant" : "interviewer",
      channel: row.channel === "voice" || row.channel === "visual" ? row.channel : "text",
      content: row.content, occurredAt: row.occurred_at, interrupted: Boolean(row.interrupted),
    })),
    visuals: (displays.data ?? []).flatMap((row) => {
      const action = parseDisplayAction(row.definition);
      return action ? [{ id: row.id, action, issuedAt: row.issued_at, answerMessageId: answered.get(row.id) ?? null }] : [];
    }),
    detail: detailStatus && analysis.data ? {
      status: detailStatus, summary: analysis.data.summary ?? "", error: analysis.data.error,
      coverage: readCoverage(analysis.data.objective_coverage), completedAt: analysis.data.completed_at,
    } : null,
  };
});

export const listFindings = cache(async (studyId: string): Promise<FindingRecord[]> => {
  if (!UUID.test(studyId) || !(await getResearcher())) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("findings")
    .select("id, title, summary, category, origin, status, created_at, finding_evidence (relation, messages (id, conversation_id, speaker, content, sequence))")
    .eq("study_id", studyId).neq("status", "rejected").order("created_at", { ascending: false });
  if (error) throw new Error("Findings could not be loaded.");
  const interviews = await listInterviews(studyId);
  const participant = new Map(interviews.map((item) => [item.id, item.participant]));
  return (data ?? []).map((row) => ({
    id: row.id, title: row.title, summary: row.summary ?? "",
    category: FINDING_CATEGORIES.find((value) => value === row.category) ?? "other",
    origin: row.origin === "ai" ? "ai" : "researcher",
    status: row.status === "accepted" ? "accepted" : "proposed",
    evidence: (row.finding_evidence ?? []).flatMap((link) => (link.messages ? [{
      messageId: link.messages.id, conversationId: link.messages.conversation_id,
      participant: participant.get(link.messages.conversation_id) ?? "Participant",
      speaker: link.messages.speaker === "participant" ? "participant" as const : "interviewer" as const,
      content: link.messages.content, relation: link.relation === "contradicts" ? "contradicts" as const : "supports" as const,
    }] : [])),
  }));
});
