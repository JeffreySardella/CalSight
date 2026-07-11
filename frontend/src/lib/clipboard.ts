/**
 * Copy text to the clipboard, falling back to the legacy execCommand path on
 * non-secure contexts (e.g. plain http) where the async Clipboard API is
 * blocked. Returns whether the copy actually succeeded so callers can show
 * accurate feedback instead of a silent lie.
 *
 * Extracted from ShareButton so every copy affordance (share link, Ask AI
 * answer copy, export panel copy-link) shares one battle-tested path.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard API blocked (e.g. http://) — fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
