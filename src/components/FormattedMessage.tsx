import React from 'react';
import {
  formatAiResponseForChannel,
  parseAiResponseInline,
  parseAiResponseMarkdown,
} from '../shared/aiResponseFormatting';

const PLAIN_TEXT_CHANNELS = new Set(['SMS', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'MESSENGER']);

const InlineText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseAiResponseInline(text).map((segment, index) => {
      const key = segment.type + '-' + index;
      if (segment.type === 'strong') return <strong key={key} className="font-semibold">{segment.text}</strong>;
      if (segment.type === 'em') return <em key={key}>{segment.text}</em>;
      if (segment.type === 'strike') return <del key={key}>{segment.text}</del>;
      if (segment.type === 'underline') return <u key={key} className="underline decoration-current underline-offset-2">{segment.text}</u>;
      if (segment.type === 'highlight') return <mark key={key} className="rounded bg-amber-100 px-1 text-inherit">{segment.text}</mark>;
      if (segment.type === 'code') return <code key={key} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.95em]">{segment.text}</code>;
      return <React.Fragment key={key}>{segment.text}</React.Fragment>;
    })}
  </>
);

export const FormattedMessage: React.FC<{ text: string; className?: string; channel?: string }> = ({
  text,
  className,
  channel = 'WEBSITE',
}) => {
  const normalizedChannel = String(channel || 'WEBSITE').toUpperCase();
  const displayText = formatAiResponseForChannel(text, normalizedChannel);
  if (PLAIN_TEXT_CHANNELS.has(normalizedChannel)) {
    return (
      <div className={[className, 'whitespace-pre-wrap', 'leading-relaxed'].filter(Boolean).join(' ')}>
        {displayText}
      </div>
    );
  }

  return (
    <div className={className || 'space-y-2'}>
      {parseAiResponseMarkdown(displayText).map((block, index) => {
        if (block.type === 'heading') return <h4 key={'heading-' + index} className="font-semibold leading-snug"><InlineText text={block.text} /></h4>;
        if (block.type === 'ul') return <ul key={'ul-' + index} className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}</ul>;
        if (block.type === 'ol') return <ol key={'ol-' + index} className="list-decimal space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}</ol>;
        return <p key={'paragraph-' + index} className="whitespace-pre-wrap leading-relaxed"><InlineText text={block.text} /></p>;
      })}
    </div>
  );
};
