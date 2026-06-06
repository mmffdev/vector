// Export manager — turns an array of normalised lines into a download or a
// clipboard payload. TXT/CSV/JSON are produced server-side (POST /api/export)
// so large exports don't block the UI thread; clipboard + small HTML previews
// are produced client-side for instant feedback.

export async function exportLines({ lines, format, source, toast }) {
  if (!lines.length) {
    toast?.('Nothing to export — no lines in that scope.', 'warn');
    return;
  }

  if (format === 'clipboard') {
    const text = lines
      .map((l) => `[${source}:${l.lineNumber ?? '?'}] ${l.ts ?? ''} ${l.level} ${l.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast?.(`Copied ${lines.length} lines to clipboard.`, 'ok');
    } catch {
      toast?.('Clipboard blocked by browser.', 'err');
    }
    return;
  }

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, format, lines }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${source}-export.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast?.(`Exported ${lines.length} lines → ${format.toUpperCase()}.`, 'ok');
  } catch (err) {
    toast?.(`Export failed: ${err.message}`, 'err');
  }
}

/** Copy a single line, or a line reference, to the clipboard.
 *
 * The async Clipboard API is the happy path but it fails in ways that look like
 * "nothing happened" to a user: it rejects when the document isn't focused
 * (cursor was in devtools), when the page isn't a secure context, or when the
 * permission is transiently denied. We fall back to a hidden-textarea +
 * execCommand('copy'), which works without focus or a secure context, and only
 * report failure if BOTH paths fail — surfacing the real reason rather than a
 * blanket "blocked by browser". */
export async function copyText(text, toast, what = 'line') {
  if (await writeClipboard(text)) {
    toast?.(`Copied ${what}.`, 'ok');
  } else {
    toast?.(`Couldn’t copy ${what} — clipboard unavailable.`, 'err');
  }
}

/** Write to the clipboard, trying the async API then the execCommand fallback.
 * Returns true on success. Never throws. */
export async function writeClipboard(text) {
  // Primary: async Clipboard API (needs secure context + document focus).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  // Fallback: hidden textarea + execCommand. Works without focus/secure ctx.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Keep it off-screen but still selectable (display:none can't be selected).
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
