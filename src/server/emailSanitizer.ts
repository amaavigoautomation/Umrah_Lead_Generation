/**
 * Sanitizes AI-generated email text:
 * 1. Strips all double asterisks (**) used for Markdown bolding.
 * 2. Enforces formal professional greetings (e.g. "Dear [Name]," or "Hello [Name],") and strips Muslim/religious greetings
 *    such as "Assalamu Alaikum", "Walaikum Assalam", "As-salamu alaykum", "Wa alaykum as-salam", "Salam", etc.
 */
export function sanitizeAiEmailText(text: string, recipientName?: string): string {
  if (!text) return text;

  // Step 1: Strip double asterisks
  let cleaned = text.replaceAll('**', '');

  // Step 2: Ensure formal greetings and remove Muslim greetings
  const greetingName = recipientName ? recipientName.trim() : '';
  const formalGreeting = greetingName ? `Dear ${greetingName},` : 'Dear Customer,';

  // Replace Muslim greetings at the beginning of text or lines
  const muslimGreetingRegex = /^(Assalamu\s+Alaikum|Walaikum\s+Assalam|Wa\s+Alaikum\s+Assalam|As-salamu\s+alaykum|Wa\s+alaykum\s+as-salam|Assalam-o-Alaikum)[^\n,!]*(,|\n|!|\s)+/i;

  if (muslimGreetingRegex.test(cleaned)) {
    cleaned = cleaned.replace(muslimGreetingRegex, `${formalGreeting}\n\n`);
  }

  // Also replace any subsequent line occurrences if any
  cleaned = cleaned.replace(/(\n)(Assalamu\s+Alaikum|Walaikum\s+Assalam|Wa\s+Alaikum\s+Assalam|As-salamu\s+alaykum|Wa\s+alaykum\s+as-salam|Assalam-o-Alaikum)[^\n,!]*(,|\n|!|\s)+/gi, (match, p1) => {
    return `${p1}${formalGreeting}\n\n`;
  });

  return cleaned.trim();
}
