import type { Metadata } from "next";
import VisualGallery from "@/components/interview/VisualGallery";

export const metadata: Metadata = {
  title: "Qalvi: Interactive visuals preview",
  description: "A local preview of the visuals that can appear during a Qalvi conversation.",
};

export default function VisualsPreviewPage() {
  return <VisualGallery />;
}
