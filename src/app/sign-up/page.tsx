import type { Metadata } from "next";
import Link from "next/link";
import { QalviOrb } from "@/components/ui/primitives";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { supabaseConfigured } from "@/lib/supabase/config";
import { SignUpForm } from "./SignUpForm";
import "../(research)/research.css";

export const metadata: Metadata = { title: "Create account · Qalvi" };

export default function SignUpPage() {
  return (
    <div className="auth-page">
      <main className="auth-panel">
        <QalviOrb size="large" />
        <p className="q-eyebrow">RESEARCH WORKSPACE</p>
        <h1>Create your Qalvi account</h1>
        <p className="auth-lede">Set up a private workspace for your studies and the conversations behind them.</p>
        {supabaseConfigured() ? (
          <SignUpForm needsCode={Boolean(process.env.QALVI_SIGNUP_CODE)} />
        ) : (
          <p role="alert" className="q-card auth-unavailable">
            Accounts are not available yet. The workspace has not been connected to its database.
          </p>
        )}
        <p className="auth-switch">
          Already have an account? <Link href={SIGN_IN_PATH}>Sign in</Link>
        </p>
        <p className="quiet-note">
          Taking part in a conversation? Open the link you were given. You do not need an account.
        </p>
      </main>
    </div>
  );
}
