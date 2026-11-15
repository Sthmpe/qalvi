import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { readObjectives } from "@/lib/studies/setup";
import { analysisPrompt, referenceLines, validateAnalysis, type TranscriptLine } from "./analysisShape";

const MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 45_000;

export type AnalysisOutcome =
  | { status: "completed"; findings: number }
  | { status: "busy" | "empty" | "not_found" | "unconfigured" | "failed"; message: string };

type Client = SupabaseClient<Database>;
type Complete = (system: string, user: string) => Promise<unknown>;

async function groqComplete(system: string, user: string): Promise<unknown> {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, temperature: 0.1, max_completion_tokens: 2500, reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "The AI provider is busy. Try again shortly." : "The AI provider returned an error.");
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(body.choices?.[0]?.message?.content ?? "null");
}

/**
 * One bounded analysis of one saved interview. The researcher's own RLS client
 * proves they may read it; the elevated client only records the run and saves
 * findings through RPCs that reject evidence from outside the conversation.
 * A failure is stored and can be retried; the transcript is never affected.
 */
export async function analyseConversation(conversationId: string, researcher: Client,
  options: { admin?: Client; complete?: Complete } = {}): Promise<AnalysisOutcome> {
  const { data: conversation, error } = await researcher.from("conversations")
    .select("id, study_id").eq("id", conversationId).maybeSingle();
  if (error || !conversation) return { status: "not_found", message: "Interview not found." };
  const { data: study } = await researcher.from("studies")
    .select("research_goal, objectives").eq("id", conversation.study_id).maybeSingle();
  const { data: rows, error: messageError } = await researcher.from("messages")
    .select("id, speaker, content, sequence").eq("conversation_id", conversationId).order("sequence");
  if (messageError) return { status: "failed", message: "The transcript could not be read." };
  const lines: TranscriptLine[] = (rows ?? []).map((row) => ({
    id: row.id, speaker: row.speaker === "participant" ? "participant" : "interviewer", content: row.content,
  }));
  if (!lines.some((line) => line.speaker === "participant")) {
    return { status: "empty", message: "There are no participant messages to analyse yet." };
  }
  const complete = options.complete ?? (process.env.GROQ_API_KEY ? groqComplete : null);
  if (!complete) return { status: "unconfigured", message: "AI analysis is not configured on this deployment." };

  const admin = options.admin ?? createSupabaseSecretClient();
  const { data: started, error: beginError } = await admin.rpc("begin_conversation_analysis", { p_conversation_id: conversationId });
  if (beginError) return { status: "failed", message: "Analysis could not be started." };
  if (!started) return { status: "busy", message: "This interview is already being analysed." };

  const fail = async (message: string): Promise<AnalysisOutcome> => {
    await admin.rpc("fail_conversation_analysis", { p_conversation_id: conversationId, p_error: message });
    return { status: "failed", message };
  };
  try {
    const objectives = readObjectives(study?.objectives).map(({ id, topic }) => ({ id, topic }));
    const { byRef, text } = referenceLines(lines);
    const prompt = analysisPrompt(study?.research_goal ?? "", objectives, text);
    const analysis = validateAnalysis(await complete(prompt.system, prompt.user), byRef, objectives);
    if (!analysis) return await fail("The AI reply could not be verified against the transcript.");
    const { data: saved, error: saveError } = await admin.rpc("complete_conversation_analysis", {
      p_conversation_id: conversationId, p_summary: analysis.summary,
      p_objective_coverage: analysis.coverage as unknown as Json,
      p_findings: analysis.findings as unknown as Json, p_model: MODEL,
    });
    if (saveError) return await fail("The analysis could not be saved.");
    return { status: "completed", findings: saved ?? 0 };
  } catch (cause) {
    return await fail(cause instanceof Error && cause.message.startsWith("The AI provider") ? cause.message : "Analysis did not finish. You can try again.");
  }
}
