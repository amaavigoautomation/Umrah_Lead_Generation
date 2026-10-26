import React from 'react';

/**
 * Minimal, dependency-free Markdown renderer for legal text. It builds React elements only (never raw HTML),
 * so admin-authored text cannot inject scripts. Supported: paragraphs, "-"/"*"/"1." lists, ### headings,
 * **bold**, *italic*, [text](https://link) and bare line breaks.
 */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2] !== undefined) nodes.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={key}>{m[3]}</em>);
    else if (SAFE_LINK.test(m[5])) {
      nodes.push(
        <a key={key} href={m[5]} target="_blank" rel="noopener noreferrer" className="text-orange-600 underline hover:text-orange-700">
          {m[4]}
        </a>,
      );
    } else nodes.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const LegalMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const key = `b${bi}`;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={key} className="list-disc pl-6 space-y-1">
              {lines.map((l, li) => <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''), `${key}-${li}`)}</li>)}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={key} className="list-decimal pl-6 space-y-1">
              {lines.map((l, li) => <li key={li}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ''), `${key}-${li}`)}</li>)}
            </ol>
          );
        }
        const h = block.match(/^#{3,6}\s+(.+)$/);
        if (h && lines.length === 1) return <h3 key={key} className="font-semibold text-slate-900 pt-2">{renderInline(h[1], key)}</h3>;
        return (
          <p key={key}>
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l, `${key}-${li}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
};
