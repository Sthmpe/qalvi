"use server";

import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HOME_PATH, MIN_PASSWORD_LENGTH, SIGN_IN_PATH, safeNext } from "./routes";
import { getResearcher } from "./session";
import { ensureWorkspace } from "./workspace";

export type SignInState = { error: string | null; email?: string };
export type SignUpState = { error: string | null; email?: string; name?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNAVAILABLE = "Sign in is not available right now. Please try again shortly.";

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email || !password) return { error: "Enter your email and password.", email };
  if (!supabaseConfigured()) return { error: UNAVAILABLE, email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // One message for every credential failure, so the form never reveals which accounts exist.
    return { error: error?.status === 429 ? UNAVAILABLE : "That email and password do not match an account.", email };
  }

  try {
    // The same client now carries the new session, so this runs as the researcher.
    await ensureWorkspace(supabase, data.user.id);
  } catch {
    // Signed in without a workspace: the workspace page offers setup instead.
  }
  redirect(next);
}

export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect(SIGN_IN_PATH);
}

/** Explicit, user-triggered setup for a researcher who signed in without a workspace. */
export async function setUpWorkspace() {
  const researcher = await getResearcher();
  if (!researcher) redirect(SIGN_IN_PATH);
  const supabase = await createSupabaseServerClient();
  await ensureWorkspace(supabase, researcher.id);
  redirect(HOME_PATH);
}

/**
 * Create a researcher account and sign straight in. The account is created
 * server-side as already confirmed, so it does not depend on email delivery.
 * If QALVI_SIGNUP_CODE is set, a matching code is required, which keeps a
 * public deployment from accepting accounts from anyone who finds the page.
 */
export async function signUp(_previous: SignUpState, form: FormData): Promise<SignUpState> {
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const code = String(form.get("code") ?? "").trim();
  const keep = { email, name };
  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email address.", ...keep };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 72) {
    return { error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`, ...keep };
  }
  const requiredCode = process.env.QALVI_SIGNUP_CODE;
  if (requiredCode && code !== requiredCode) return { error: "That access code is not valid.", ...keep };
  if (!supabaseConfigured()) return { error: UNAVAILABLE, ...keep };

  let admin;
  try {
    admin = createSupabaseSecretClient();
  } catch {
    return { error: UNAVAILABLE, ...keep };
  }
  const { error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: name ? { display_name: name } : undefined,
  });
  if (createError) {
    const taken = createError.status === 422 || /already/i.test(createError.message);
    return { error: taken ? "An account with this email already exists. Sign in instead." : UNAVAILABLE, ...keep };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Your account was created. Sign in to continue.", ...keep };
  try {
    await ensureWorkspace(supabase, data.user.id);
  } catch {
    // The workspace page offers explicit setup if this did not complete.
  }
  redirect(HOME_PATH);
}
