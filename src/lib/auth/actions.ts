"use server";

import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HOME_PATH, SIGN_IN_PATH, safeNext } from "./routes";
import { getResearcher } from "./session";
import { ensureWorkspace } from "./workspace";

export type SignInState = { error: string | null; email?: string };

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
