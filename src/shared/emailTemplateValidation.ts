/** Keep this list aligned with replacement logic in campaignService.ts. */
export const SUPPORTED_EMAIL_TEMPLATE_VARIABLES = [
  'name', 'firstName', 'lastName', 'company', 'companyName', 'designation', 'jobTitle', 'email',
] as const;
const supportedVariablesLowercase = new Set(SUPPORTED_EMAIL_TEMPLATE_VARIABLES.map((name) => name.toLowerCase()));
export interface EmailTemplateVariableSource {
  subject?: string | null;
  body?: string | null;
  htmlBody?: string | null;
}
/** Returns placeholder names the existing email renderer cannot populate. */
export function getUnsupportedEmailTemplateVariables(template: EmailTemplateVariableSource): string[] {
  const content = [template.subject, template.body, template.htmlBody]
    .filter((value): value is string => typeof value === 'string').join('\n');
  const unsupported = new Set<string>();
  const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = variablePattern.exec(content)) !== null) {
    const name = match[1].trim();
    if (name && !supportedVariablesLowercase.has(name.toLowerCase())) unsupported.add(name);
  }
  return Array.from(unsupported).sort((a, b) => a.localeCompare(b));
}
