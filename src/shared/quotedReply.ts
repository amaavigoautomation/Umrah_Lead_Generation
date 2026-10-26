/**
 * Removes the quoted earlier conversation from an email reply, leaving what the sender newly wrote:
 * "On <date>, <name> wrote:" blocks, "> " quoted lines, Outlook "From:/Sent:" headers and
 * "Original Message" / "Forwarded message" separators.
 *
 * Unlike stripQuotedEmailHistory (used for intent detection) this keeps the sender's own sign-off and
 * signature, because it is used for what people read in the inbox. If stripping would leave nothing
 * (for example a pure forward) the original text is returned unchanged.
 */
export function stripQuotedReply(text: string | null | undefined): string {
  const original = String(text ?? '');
  if (!original.trim()) return original;
  let t = original.replace(/\r\n/g, '\n');
  // "On Mon, 26 Oct 2026 at 4:20 PM Jane <jane@x.com> wrote:" (the header may wrap over several lines)
  t = t.replace(/(^|\n)[ \t]*On\s[\s\S]{0,400}?\swrote:[\s\S]*$/i, '');
  t = t.replace(/(^|\n)[ \t]*-{2,}\s*(Original Message|Forwarded message)[\s\S]*$/i, '');
  t = t.replace(/(^|\n)[ \t]*_{5,}[\s\S]*$/, '');
  t = t.replace(/(^|\n)[ \t]*From:[^\n]*\n[ \t]*(?:Sent|Date|To|Subject)[^\n]*:[\s\S]*$/i, '');
  t = t.replace(/^[ \t]*>.*(?:\n|$)/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t || original.trim();
}
