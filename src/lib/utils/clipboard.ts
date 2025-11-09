export type ClipboardCopyResult =
  | { success: true; method: 'clipboard-api' | 'execCommand' }
  | { success: false; reason: 'unsupported' | 'error'; error?: string };

function attemptExecCommandCopy(text: string): ClipboardCopyResult {
  if (typeof document === 'undefined' || !document.body) {
    return { success: false, reason: 'unsupported', error: 'document-unavailable' };
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand('copy');

    document.body.removeChild(textarea);

    if (copied) {
      return { success: true, method: 'execCommand' };
    }

    return {
      success: false,
      reason: 'unsupported',
      error: 'execCommand returned false'
    };
  } catch (err) {
    return {
      success: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return { success: true, method: 'clipboard-api' };
    } catch (err) {
      const fallback = attemptExecCommandCopy(text);
      if (fallback.success) {
        return fallback;
      }
      return {
        success: false,
        reason: 'error',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  return attemptExecCommandCopy(text);
}
