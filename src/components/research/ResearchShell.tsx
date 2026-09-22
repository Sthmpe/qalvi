import Link from "next/link";
import type { ReactNode } from "react";
import { Navigation } from "./Navigation";
import { QalviOrb } from "@/components/ui/primitives";

export default function ResearchShell({ children }: { children: ReactNode }) {
  return (
    <div className="research-shell">
      <a className="q-skip" href="#main-content">
        Skip to content
      </a>
      <aside className="research-sidebar">
        <Link href="/dashboard" className="q-brand">
          <QalviOrb />
          Qalvi<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-monogram">R</span>
          <div>
            Research workspace<small>Room for better questions</small>
          </div>
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <Navigation
          label="Workspace"
          className="primary-nav"
          items={[
            { href: "/dashboard", label: "Overview", mark: "◫" },
            { href: "/studies", label: "Studies", mark: "▤" },
          ]}
        />
        <div className="sidebar-note">
          <span className="note-line" />
          <p>
            Good questions.
            <br />
            Honest conversations.
            <br />
            <strong>Better understanding.</strong>
          </p>
        </div>
        <div className="sidebar-footer">
          <span className="sample-dot" /> Sample workspace
          <small>Illustrative data · nothing is stored</small>
        </div>
      </aside>
      <div className="research-body">
        <header className="research-header">
          <span className="desktop-header-label">
            Conversations, grounded in evidence.
          </span>
          <Link href="/dashboard" className="mobile-brand">
            <QalviOrb />
            Qalvi
          </Link>
          <div className="header-end">
            <span className="header-preview">Sample workspace</span>
            <span className="q-avatar" aria-label="Research workspace">
              R
            </span>
          </div>
        </header>
        <Navigation
          label="Mobile workspace"
          className="mobile-nav"
          items={[
            { href: "/dashboard", label: "Overview" },
            { href: "/studies", label: "Studies" },
            { href: "/studies/new", label: "+ New study" },
          ]}
        />
        <main id="main-content" className="research-main" tabIndex={-1}>
          {children}
        </main>
        <footer className="research-footer">
          <span>Built around conversations. Grounded in evidence.</span>
          <span>Qalvi · Research with care</span>
        </footer>
      </div>
    </div>
  );
}
