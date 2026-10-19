import React, { useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';

const NAME_FIX: Record<string, string> = {
  'united states of america': 'united states of america',
  'czech republic': 'czechia',
  'dem. rep. congo': 'democratic republic of the congo',
  'bosnia and herz.': 'bosnia and herzegovina',
  'dominican rep.': 'dominican republic',
  'central african rep.': 'central african republic',
  'eq. guinea': 'equatorial guinea',
  's. sudan': 'south sudan',
  'w. sahara': 'western sahara',
  'solomon is.': 'solomon islands',
  'eswatini': 'swaziland',
};

const key = (s: string) => {
  const k = s.trim().toLowerCase();
  return NAME_FIX[k] || k;
};

/** World choropleth: darker = more leads. Countries with no leads stay light grey. */
const LeadMap: React.FC<{ countries: Array<{ name: string; count: number }> }> = ({ countries }) => {
  const [hover, setHover] = useState<{ name: string; count: number } | null>(null);
  const shapes = useMemo(() => {
    const fc: any = feature(world as any, (world as any).objects.countries);
    const projection = geoNaturalEarth1().fitSize([960, 500], fc);
    const path = geoPath(projection);
    return fc.features.map((f: any) => ({ name: String(f.properties?.name || ''), d: path(f) || '' }));
  }, []);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    countries.forEach((c) => m.set(key(c.name), (m.get(key(c.name)) || 0) + c.count));
    return m;
  }, [countries]);
  const max = Math.max(1, ...countries.map((c) => c.count));

  const fill = (n: number) => {
    if (!n) return '#e2e8f0';
    const t = Math.sqrt(n / max); // sqrt so a few big markets don't wash out the small ones
    const l = 88 - t * 48; // light -> deep orange
    return `hsl(24 92% ${l}%)`;
  };

  return (
    <div className="relative">
      <svg viewBox="0 0 960 500" className="w-full h-auto" role="img" aria-label="Lead locations world map">
        {shapes.map((s: any, i: number) => {
          const n = counts.get(key(s.name)) || 0;
          return (
            <path
              key={`${s.name}-${i}`}
              d={s.d}
              fill={fill(n)}
              stroke="#fff"
              strokeWidth={0.5}
              onMouseEnter={() => setHover({ name: s.name, count: n })}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.name}: ${n} lead${n === 1 ? '' : 's'}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="absolute left-2 top-2 text-xs bg-white/90 border border-slate-200 rounded px-2 py-1 min-h-[24px]">
        {hover ? `${hover.name}: ${hover.count} lead${hover.count === 1 ? '' : 's'}` : 'Hover a country'}
      </div>
      <div className="absolute right-2 bottom-2 flex items-center gap-1 text-[10px] text-slate-500 bg-white/90 border border-slate-200 rounded px-2 py-1">
        Fewer
        <span className="inline-block w-16 h-2 rounded" style={{ background: 'linear-gradient(90deg, hsl(24 92% 88%), hsl(24 92% 40%))' }} />
        More
      </div>
    </div>
  );
};

export default LeadMap;
