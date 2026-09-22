import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  PageHeading,
  QalviOrb,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  conversations,
  findings,
  studies,
  templates,
} from "@/lib/research/mock-data";
import StudyCard from "./StudyCard";

export default function Dashboard() {
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESEARCH, IN FOCUS"
        title="What do you want to learn?"
        description="AI-led voice and text interviews that help your team learn from customers, prospects, users, and communities."
        action={
          <ButtonLink href="/studies/new">
            <span aria-hidden="true">＋</span> Create study
          </ButtonLink>
        }
      />
      <section className="dashboard-intro" aria-label="Research overview">
        <div className="intro-copy">
          <Badge tone="indigo">Every conversation is a starting point</Badge>
          <h2>
            Listen closely.
            <br />
            <span>See what matters.</span>
          </h2>
          <p>
            Start with a research question. Learn through natural conversations.
            Turn what you hear into insights you can trace to the original words.
          </p>
          <Link href="/studies/new" className="text-link">
            Start with a question <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="intro-orb">
          <QalviOrb size="large" />
          <span>Space to speak. Room to discover.</span>
        </div>
      </section>
      <div className="research-stats" aria-label="Sample research counts">
        <div>
          <strong>{studies.length.toString().padStart(2, "0")}</strong>
          <span>Studies taking shape</span>
        </div>
        <div>
          <strong>{conversations.length.toString().padStart(2, "0")}</strong>
          <span>Conversations to learn from</span>
        </div>
        <div>
          <strong>{findings.length.toString().padStart(2, "0")}</strong>
          <span>Findings linked to evidence</span>
        </div>
        <p>
          Sample data
          <br />
          <span>A preview of your research home</span>
        </p>
      </div>
      <section>
        <SectionHeading
          title="Recent studies"
          description="Your questions, becoming clearer."
          action={
            <Link href="/studies" className="text-link">
              All studies <span aria-hidden="true">→</span>
            </Link>
          }
        />
        <div className="study-grid">
          {studies.map((study) => (
            <StudyCard key={study.id} study={study} />
          ))}
        </div>
      </section>
      <section>
        <SectionHeading
          title="Start with a little direction"
          description="A few good starting points. Make the question your own."
        />
        <div className="template-grid">
          {templates.slice(0, 4).map((template) => (
            <Link
              href={`/studies/new?template=${template.id}`}
              className="template-card"
              key={template.id}
            >
              <span className="template-mark">{template.mark}</span>
              <h3>
                {template.name} <span aria-hidden="true">↗</span>
              </h3>
              <p>{template.description}</p>
            </Link>
          ))}
        </div>
      </section>
      <Card className="evidence-note">
        <span className="evidence-symbol" aria-hidden="true">
          “
        </span>
        <div>
          <h2>The conversation comes first.</h2>
          <p>
            Findings are interpretations. Original participant messages remain
            the source of truth.
          </p>
        </div>
        <Link href="/studies/everyday-work/interviews" className="text-link">
          Explore the evidence <span aria-hidden="true">→</span>
        </Link>
      </Card>
    </>
  );
}
