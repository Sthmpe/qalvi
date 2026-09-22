import type { Metadata } from "next";
import ResearchShell from "@/components/research/ResearchShell";
import "./research.css";
export const metadata: Metadata = {
  title: { default: "Qalvi — Research workspace", template: "%s · Qalvi" },
  description:
    "Structured conversations. Original evidence. Better understanding.",
};
export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ResearchShell>{children}</ResearchShell>;
}
