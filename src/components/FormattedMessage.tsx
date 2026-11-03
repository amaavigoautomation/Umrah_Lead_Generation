import React from 'react';
import { parseAiResponseInline, parseAiResponseMarkdown } from '../shared/aiResponseFormatting';

const InlineText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseAiResponseInline(text).map((segment, index) => {
      const key = segment.type + '-' + index;
      if (segment.type === 'strong') return <strong key={key} className="font-semibold">{segment.text}</strong>;
      if (segment.type === 'em') return <em key={key}>{segment.text}</em>;
      if (segment.type === 'strike') return <del key={key}>{segment.text}</del>;
      if (segment.type === 'code') return <code key={key} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.95em]">{segment.text}</code>;
      return <React.Fragment key={key}>{segment.text}</React.Fragment>;
    })}
  </>
);
export const FormattedMessage: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div className={className || 'space-y-2'}>
    {parseAiResponseMarkdown(text).map((block, index) => {
      if (block.type === 'heading') return <h4 key={'heading-' + index} className="font-semibold leading-snug"><InlineText text={block.text} /></h4>;
      if (block.type === 'ul') return <ul key={'ul-' + index} className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}</ul>;
      if (block.type === 'ol') return <ol key={'ol-' + index} className="list-decimal space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}</ol>;
      return <p key={'paragraph-' + index} className="whitespace-pre-wrap leading-relaxed"><InlineText text={block.text} /></p>;
    })}
  </div>
);
