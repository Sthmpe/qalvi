import type { Metadata } from "next";
import InterviewRoom from "@/components/interview/InterviewRoom";

export const metadata: Metadata = {
  title: "Qalvi — Interview",
  description: "A mocked participant interview experience for Qalvi.",
};

export default function InterviewDemoPage() {
  return <InterviewRoom />;
}
