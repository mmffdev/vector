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

/** Copy a single line, or a line reference, to the clipboard. */
export async function copyText(text, toast, what = 'line') {
  try {
    await navigator.clipboard.writeText(text);
    toast?.(`Copied ${what}.`, 'ok');
  } catch {
    toast?.('Clipboard blocked by browser.', 'err');
  }
}
