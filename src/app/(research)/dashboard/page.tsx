import Dashboard from "@/components/research/Dashboard";
import { listStudies, studyCounts } from "@/lib/studies/queries";
export default async function DashboardPage() {
  const [studies, counts] = await Promise.all([listStudies(), studyCounts()]);
  return <Dashboard studies={studies} counts={counts} />;
}
