import type { Metadata } from "next";
import { QalviOrb } from "@/components/ui/primitives";
import { safeNext } from "@/lib/auth/routes";
import { supabaseConfigured } from "@/lib/supabase/config";
import { SignInForm } from "./SignInForm";
import "../(research)/research.css";

export const metadata: Metadata = { title: "Sign in · Qalvi" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="auth-page">
      <main className="auth-panel">
        <QalviOrb size="large" />
        <p className="q-eyebrow">RESEARCH WORKSPACE</p>
        <h1>Sign in to Qalvi</h1>
        <p className="auth-lede">Your studies, conversations, and the evidence behind them.</p>
        {supabaseConfigured() ? (
          <SignInForm next={safeNext(Array.isArray(next) ? next[0] : next)} />
        ) : (
          <p role="alert" className="q-card auth-unavailable">
            Sign in is not available yet. The workspace has not been connected to its database.
          </p>
        )}
        <p className="quiet-note">
          Taking part in a conversation? Open the link you were given. You do not need an account.
        </p>
      </main>
    </div>
  );
}
