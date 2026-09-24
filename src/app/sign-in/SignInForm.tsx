"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/lib/auth/actions";

const initial: SignInState = { error: null };

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="q-card auth-form">
      <input type="hidden" name="next" value={next} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="auth-error">
          {state.error}
        </p>
      )}
      <button type="submit" className="q-button q-button--primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
