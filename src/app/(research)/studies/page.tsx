import StudyLibrary from "@/components/research/StudyLibrary";
import { listStudies } from "@/lib/studies/queries";
export const metadata = { title: "Studies" };
export default async function StudiesPage() {
  return <StudyLibrary studies={await listStudies()} />;
}
