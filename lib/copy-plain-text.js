/**
 * Copy plain text: try Clipboard API first, then legacy execCommand (works on more HTTP setups).
 * @returns {Promise<boolean>} true if the text was copied without needing a prompt
 */
export async function copyPlainTextWithLegacyFallback(text) {
  const t = String(text ?? "").trim();
  if (!t) {
    return false;
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    /* fall through to legacy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}
