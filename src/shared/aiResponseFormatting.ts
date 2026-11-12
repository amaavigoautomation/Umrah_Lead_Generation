/**
 * Shared Markdown subset for AI-generated customer replies.
 * This format is translated for each channel at the rendering/sending boundary.
 */
export type AiResponseSegmentType = 'text' | 'strong' | 'em' | 'strike' | 'code' | 'underline' | 'highlight';
export interface AiResponseSegment { type: AiResponseSegmentType; text: string; }
export type AiResponseBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

export const AI_RESPONSE_FORMATTING_INSTRUCTIONS = [
  'Use restrained, professional Markdown formatting to make the answer easy to scan.',
  'Use **bold** selectively for important labels, prices, dates, deadlines, key conditions and next steps; do not bold whole paragraphs.',
  'Use _italics_ sparingly for secondary notes or qualifications.',
  'Use ++underline++ very sparingly for a short important phrase and ==highlight== only for a critical short note; avoid decorating whole paragraphs.',
  'For three or more related items, use a concise - bullet list; use a numbered list only for sequential steps.',
  'Use short paragraphs and, only for longer replies, simple ## headings.',
  'Do not add decorative separators, unnecessary emojis, tables, or excessive formatting.',
  'Generate one channel-neutral Markdown source. The application converts it to each channel’s native display format; never write platform-specific markup or HTML.',
  'Never change, infer or invent facts while formatting. Do not output HTML or fenced code blocks.'
].join(' ');

const INLINE_PATTERN = /(\+\+[^+\n]+?\+\+|==[^=\n]+?==|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|`[^`\n]+`|(?<!\*)\*[^*\n]+?\*(?!\*)|(?<!_)_[^_\n]+?_(?!_)|(?<!~)~[^~\n]+?~(?!~))/g;

export function parseAiResponseInline(input: string): AiResponseSegment[] {
  const text = String(input || ''), segments: AiResponseSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    const token = match[0];
    if (token.startsWith('++')) segments.push({ type: 'underline', text: token.slice(2, -2) });
    else if (token.startsWith('==')) segments.push({ type: 'highlight', text: token.slice(2, -2) });
    else if (token.startsWith('**') || token.startsWith('__')) segments.push({ type: 'strong', text: token.slice(2, -2) });
    else if (token.startsWith('~~')) segments.push({ type: 'strike', text: token.slice(2, -2) });
    else if (token.startsWith('~')) segments.push({ type: 'strike', text: token.slice(1, -1) });
    else if (token.startsWith('`')) segments.push({ type: 'code', text: token.slice(1, -1) });
    else if (token.startsWith('*')) segments.push({ type: 'strong', text: token.slice(1, -1) });
    else segments.push({ type: 'em', text: token.slice(1, -1) });
    cursor = match.index + token.length;
  }
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments.length ? segments : [{ type: 'text', text }];
}

export function parseAiResponseMarkdown(input: string): AiResponseBlock[] {
  const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: AiResponseBlock[] = [];
  let paragraph: string[] = [], listType: 'ul' | 'ol' | null = null, listItems: string[] = [];
  const flushParagraph = () => { const value = paragraph.join('\n').trim(); if (value) blocks.push({ type: 'paragraph', text: value }); paragraph = []; };
  const flushList = () => { if (listType && listItems.length) blocks.push({ type: listType, items: [...listItems] }); listType = null; listItems = []; };
  for (const line of lines) {
    const heading = line.match(/^\s*#{1,3}\s+(.+?)\s*$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+?)\s*$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'heading', text: heading[1] }); continue; }
    if (bullet || numbered) {
      flushParagraph();
      const nextType = bullet ? 'ul' : 'ol';
      if (listType !== nextType) flushList();
      listType = nextType; listItems.push((bullet || numbered)![1]); continue;
    }
    flushList(); paragraph.push(line);
  }
  flushParagraph(); flushList();
  return blocks;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
function inlineHtml(value: string): string {
  return parseAiResponseInline(value).map((segment) => {
    const safe = escapeHtml(segment.text);
    switch (segment.type) {
      case 'strong': return '<strong>' + safe + '</strong>';
      case 'em': return '<em>' + safe + '</em>';
      case 'strike': return '<del>' + safe + '</del>';
      case 'underline': return '<u style="text-decoration:underline;text-underline-offset:2px">' + safe + '</u>';
      case 'highlight': return '<mark style="background-color:#fff1bd;color:inherit;padding:0 3px;border-radius:3px">' + safe + '</mark>';
      case 'code': return '<code style="font-family:Consolas,monospace;background:#F1F3F5;padding:1px 3px">' + safe + '</code>';
      default: return safe;
    }
  }).join('');
}
export function renderAiResponseMarkdownHtml(input: string, lineHeight = 1.72): string {
  const safeLineHeight = Number.isFinite(lineHeight) ? Math.max(1.35, Math.min(2, lineHeight)) : 1.72;
  return parseAiResponseMarkdown(input).map((block) => {
    if (block.type === 'heading') return '<h3 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.35;font-weight:700;color:inherit">' + inlineHtml(block.text) + '</h3>';
    if (block.type === 'ul' || block.type === 'ol') {
      const tag = block.type === 'ul' ? 'ul' : 'ol';
      const items = block.items.map((item) => '<li style="margin:0 0 7px 0;padding-left:2px;line-height:' + safeLineHeight + '">' + inlineHtml(item) + '</li>').join('');
      return '<' + tag + ' style="margin:0 0 17px 0;padding-left:23px">' + items + '</' + tag + '>';
    }
    return '<p style="margin:0 0 17px 0;line-height:' + safeLineHeight + '">' + inlineHtml(block.text).replace(/\n/g, '<br/>') + '</p>';
  }).join('');
}
export function aiResponseMarkdownToPlainText(input: string): string {
  return parseAiResponseMarkdown(input).map((block) => {
    if (block.type === 'heading') return parseAiResponseInline(block.text).map((s) => s.text).join('');
    if (block.type === 'ul') return block.items.map((item) => '• ' + parseAiResponseInline(item).map((s) => s.text).join('')).join('\n');
    if (block.type === 'ol') return block.items.map((item, index) => (index + 1) + '. ' + parseAiResponseInline(item).map((s) => s.text).join('')).join('\n');
    return parseAiResponseInline(block.text).map((s) => s.text).join('');
  }).join('\n\n').trim();
}
function inlineWhatsApp(value: string): string {
  return parseAiResponseInline(value).map((segment) => {
    if (segment.type === 'strong' || segment.type === 'underline' || segment.type === 'highlight') return '*' + segment.text + '*';
    if (segment.type === 'em') return '_' + segment.text + '_';
    if (segment.type === 'strike') return '~' + segment.text + '~';
    if (segment.type === 'code') return segment.text;
    return segment.text;
  }).join('');
}

export function aiResponseMarkdownToWhatsApp(input: string): string {
  return parseAiResponseMarkdown(input).map((block) => {
    if (block.type === 'heading') {
      const heading = aiResponseMarkdownToPlainText(block.text);
      return heading ? '*' + heading + '*' : '';
    }
    if (block.type === 'ul') return block.items.map((item) => '• ' + inlineWhatsApp(item)).join('\n');
    if (block.type === 'ol') return block.items.map((item, index) => (index + 1) + '. ' + inlineWhatsApp(item)).join('\n');
    return inlineWhatsApp(block.text);
  }).filter(Boolean).join('\n\n').trim();
}


/** Plain-text SMS representation: preserve labels, paragraphs and lists without rich-text markers. */
export function aiResponseMarkdownToSms(input: string): string {
  return aiResponseMarkdownToPlainText(input)
    .replace(/^\s*•\s?/gm, '- ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Shared channel adapter. Rich channels retain the Markdown source for their renderer;
 * channels without rich-text support receive a safe plain-text representation.
 */
export function formatAiResponseForChannel(input: string, channel: string): string {
  const target = String(channel || '').trim().toUpperCase();
  if (target === 'WHATSAPP') return aiResponseMarkdownToWhatsApp(input);
  if (target === 'SMS') return aiResponseMarkdownToSms(input);
  if (target === 'INSTAGRAM' || target === 'FACEBOOK' || target === 'LINKEDIN' || target === 'MESSENGER') {
    return aiResponseMarkdownToPlainText(input);
  }
  // EMAIL, WEBSITE and CHATBOT keep the canonical Markdown source for a rich renderer.
  return String(input || '').trim();
}
