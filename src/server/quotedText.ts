/**
 * Returns only what the sender newly wrote: removes quoted earlier messages
 * ("On ... wrote:", "> ..." lines, Outlook "From:" headers, "Original Message")
 * and the sign-off/signature. Intent detection must run on this, never on the
 * full email body, otherwise our own earlier text ("book a demo", "demo hours",
 * "booked for") in the quoted thread triggers scheduling.
 */
export function stripQuotedEmailHistory(text: string): string {
  if (!text) return '';
  let t = String(text).replace(/\r\n/g, '\n');
  t = t.replace(/\n?On\s[\s\S]{0,300}?\swrote:[\s\S]*$/i, '');
  t = t.replace(/\n?-{2,}\s*(Original Message|Forwarded message)[\s\S]*$/i, '');
  t = t.replace(/\n?_{5,}[\s\S]*$/, '');
  t = t.replace(/\n?From:\s.*\n(?:Sent|Date|To|Subject):[\s\S]*$/i, '');
  t = t.replace(/^>.*$/gm, '');
  t = t.replace(/\n--\s*\n[\s\S]*$/, '');
  t = t.replace(/\n\s*(Regards|Best regards|Kind regards|Thanks|Thank you|Warm regards|Sincerely|Cheers),?\s*\n[\s\S]*$/i, '');
  return t.trim();
}
