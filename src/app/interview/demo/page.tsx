import type { Metadata } from "next";
import InterviewRoom from "@/components/interview/InterviewRoom";

export const metadata: Metadata = {
  title: "Qalvi: Interview",
  description: "A realtime voice and text research conversation with Qalvi.",
};

export default function InterviewDemoPage() {
  return <InterviewRoom />;
}
