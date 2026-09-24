import Link from "next/link";
import type { ReactNode } from "react";
import { Navigation } from "./Navigation";
import { QalviOrb } from "@/components/ui/primitives";
import { signOut } from "@/lib/auth/actions";

type Account = { email: string | null; workspace: string | null };

export default function ResearchShell({
  children,
  account,
}: {
  children: ReactNode;
  account: Account;
}) {
  const workspace = account.workspace ?? "Research workspace";
  const monogram = workspace.trim().charAt(0).toUpperCase() || "R";
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
          <span className="workspace-monogram">{monogram}</span>
          <div>
            {workspace}
            <small>{account.email ?? "Room for better questions"}</small>
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
          <span className="sample-dot" /> Sample data
          <small>Illustrative studies · nothing is stored yet</small>
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
            <span className="header-preview">Sample data</span>
            <span className="q-avatar" aria-label={workspace}>
              {monogram}
            </span>
            <form action={signOut}>
              <button type="submit" className="q-button q-button--quiet sign-out">
                Sign out
              </button>
            </form>
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
