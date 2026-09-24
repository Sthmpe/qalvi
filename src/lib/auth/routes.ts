// Which paths belong to researchers, and where to send them after signing in.
// Participant interview routes are never researcher paths: participants do not
// authenticate, and the proxy does not run for them at all.

export const SIGN_IN_PATH = "/sign-in";
export const HOME_PATH = "/dashboard";

const RESEARCHER_PREFIXES = ["/dashboard", "/studies"];

export function isResearcherPath(pathname: string) {
  return pathname === "/" || RESEARCHER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The researcher page to return to after signing in. Only same-site researcher
 * paths are honoured, so the sign-in link can never become an open redirect.
 */
export function safeNext(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return HOME_PATH;
  }
  const pathname = value.split(/[?#]/, 1)[0];
  return isResearcherPath(pathname) && pathname !== "/" ? value : HOME_PATH;
}

export function signInPathFor(pathname: string, search = "") {
  const next = `${pathname}${search}`;
  return next === "/" || next === HOME_PATH
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}

/** A default name for a researcher's first workspace. */
export function firstWorkspaceName(displayName: string | null | undefined) {
  const name = displayName?.trim();
  return name ? `${name.slice(0, 100)}'s workspace` : "My workspace";
}
