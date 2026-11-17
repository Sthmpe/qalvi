"use client";

import { useActionState } from "react";
import { signUp, type SignUpState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/routes";

const initial: SignUpState = { error: null };

export function SignUpForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(signUp, initial);
  return (
    <form action={action} className="q-card auth-form">
      <label>
        Your name <span className="auth-optional">Optional</span>
        <input name="name" type="text" autoComplete="name" maxLength={80} defaultValue={state.name} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-hint" />
        <span id="password-hint" className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
      </label>
      {needsCode && (
        <label>
          Access code
          <input name="code" type="text" autoComplete="off" required />
        </label>
      )}
      {state.error && (
        <p role="alert" className="auth-error">
          {state.error}
        </p>
      )}
      <button type="submit" className="q-button q-button--primary" disabled={pending}>
        {pending ? "Creating your workspace…" : "Create account"}
      </button>
    </form>
  );
}
