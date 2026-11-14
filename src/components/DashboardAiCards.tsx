import React, { useEffect, useState } from 'react';
import { Activity, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';

type ChartType = 'kpi' | 'line' | 'bar' | 'pie' | 'area' | 'table';
type DashboardCard = {
  id:string; prompt:string; title:string; description:string; metricId:string; chartType:ChartType;
  dateRange:'7d'|'30d'|'90d'|'6m'|'12m'|'all';
  groupBy:'day'|'week'|'month'|'status'|'channel'|'none';
  comparePrevious:boolean; displayFormat:'number'|'percentage'|'currency'|'compact';
  width:'small'|'medium'|'large'; placement:'top'|'middle'|'bottom';
  filters:{statuses?:string[];channels?:string[]}; createdAt:string; updatedAt:string;
};
type CardPreview = {
  value?:number; previousValue?:number; changePercent?:number|null;
  series:Array<{label:string;value:number;previousValue?:number}>;
  note?:string; sampled?:boolean; updatedAt:string;
};

const RANGE_LABEL:Record<DashboardCard['dateRange'],string> = {
  '7d':'Last 7 days','30d':'Last 30 days','90d':'Last 90 days','6m':'Last 6 months','12m':'Last 12 months',all:'All time',
};

const formatValue=(value:number,format:DashboardCard['displayFormat'])=>{
  if(format==='percentage')return value.toLocaleString('en-IN',{maximumFractionDigits:1})+'%';
  if(format==='currency')return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
  if(format==='compact')return new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1}).format(value);
  return value.toLocaleString('en-IN',{maximumFractionDigits:1});
};

const VisualCard:React.FC<{card:DashboardCard;preview?:CardPreview;loading?:boolean;onRemove?:(id:string)=>void}> = ({card,preview,loading,onRemove}) => {
  const rows=preview?.series||[];
  const max=Math.max(1,...rows.map(row=>row.value),...rows.map(row=>row.previousValue||0));
  const colours=['#789cff','#ad91ff','#4ad6ad','#f2bf66','#f28ba6','#62c8df','#a7b4cc'];
  const width=card.width==='large'?'xl:col-span-4':card.width==='medium'?'xl:col-span-2':'xl:col-span-1';
  const points=rows.map((row,index)=>({x:rows.length<=1?300:28+index/(rows.length-1)*544,y:148-row.value/max*118,label:row.label,value:row.value}));
  const pointString=points.map(p=>p.x+','+p.y).join(' ');
  const previousPoints=rows.map((row,index)=>({x:rows.length<=1?300:28+index/(rows.length-1)*544,y:148-(row.previousValue||0)/max*118}));
  const previousPointString=previousPoints.map(p=>p.x+','+p.y).join(' ');
  const areaPath=points.length?'M '+points[0].x+' 158 L '+points.map(p=>p.x+' '+p.y).join(' L ')+' L '+points[points.length-1].x+' 158 Z':'';
  const total=rows.reduce((sum,row)=>sum+Math.max(0,row.value),0);
  let cursor=0;
  const pieStops=rows.map((row,index)=>{const end=cursor+(total?row.value/total*100:0);const part=colours[index%colours.length]+' '+cursor+'% '+end+'%';cursor=end;return part;});
  return <section className={`dashboard-ai-card group relative min-w-0 overflow-hidden rounded-xl border border-[#dfe5f0] bg-white p-4 shadow-[0_1px_3px_rgba(8,11,50,.035)] sm:p-5 ${width}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-[#eaf0ff] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-[#0848ef]">AI card</span>
          <span className="text-[9px] font-semibold uppercase tracking-[.08em] text-slate-400">{card.chartType} · {RANGE_LABEL[card.dateRange]}</span>
        </div>
        <h3 className="truncate text-[13px] font-bold tracking-[-.02em] text-[#080b32]">{card.title}</h3>
        <p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{card.description}</p>
      </div>
      {onRemove&&<button type="button" onClick={()=>onRemove(card.id)} title="Remove dashboard card" aria-label={`Remove ${card.title}`} className="rounded-lg p-1.5 text-slate-300 opacity-70 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5"/></button>}
    </div>
    {loading?<div className="mt-5 flex h-36 items-center justify-center gap-2 text-[10px] font-medium text-slate-400"><Activity className="h-4 w-4 animate-pulse text-[#0848ef]"/>Updating live workspace data…</div>
    :!preview?<div className="mt-5 flex h-36 items-center justify-center text-[10px] text-slate-400">Preview data is currently unavailable.</div>
    :card.chartType==='kpi'?<div className="mt-5 flex min-h-[108px] items-end justify-between gap-3">
      <div><div className="dashboard-ai-kpi-value text-[22px] font-bold leading-none tracking-[-.035em] text-[#080b32] tabular-nums">{formatValue(preview.value||0,card.displayFormat)}</div>
        {preview.previousValue!==undefined&&<div className={`mt-2 text-[10px] font-semibold ${preview.changePercent===null?'text-slate-400':preview.changePercent>=0?'text-emerald-600':'text-rose-600'}`}>{preview.changePercent===null?'No previous-period baseline':`${preview.changePercent>=0?'+':''}${preview.changePercent}% vs previous period`}</div>}
      </div><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf0ff] text-[#0848ef]"><Activity className="h-5 w-5"/></div>
    </div>
    :(card.chartType==='line'||card.chartType==='area')?<div className="mt-4">
      {rows.length?<svg viewBox="0 0 600 190" className="h-40 w-full overflow-visible" role="img" aria-label={card.title+' trend chart'}>
        {[40,80,120,160].map(y=><line key={y} x1="20" y1={y} x2="580" y2={y} stroke="#edf1f7" strokeDasharray="3 5"/>)}
        {card.chartType==='area'&&<path d={areaPath} fill="rgba(8,72,239,.12)"/>}
        {card.comparePrevious&&<polyline points={previousPointString} fill="none" stroke="#9ba8bd" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round"/>}
        <polyline points={pointString} fill="none" stroke="#789cff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        {points.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="4" fill="#fff" stroke="#789cff" strokeWidth="2"/>)}
      </svg>:<div className="flex h-36 items-center justify-center text-[10px] text-slate-400">No records in this date range yet.</div>}
      {card.comparePrevious&&<div className="mb-1 flex items-center gap-3 text-[8px] text-slate-400"><span className="inline-flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-[#0848ef]"/>Selected period</span><span className="inline-flex items-center gap-1"><i className="h-1.5 w-3 rounded-full bg-slate-400"/>Previous period</span></div>}
      <div className="mt-1 flex justify-between gap-2 text-[9px] font-medium text-slate-400">{rows.map((row,index)=><span key={index} className="min-w-0 truncate">{row.label}</span>)}</div>
    </div>
    :card.chartType==='bar'?<div className="mt-5 space-y-3">
      {rows.slice(0,8).map((row,index)=><div key={row.label} className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2 text-[9px]"><span className="truncate font-semibold text-slate-600">{row.label}</span><span className="shrink-0 font-bold tabular-nums text-[#17213d]">{formatValue(row.value,card.displayFormat)}</span></div>
        <div className="space-y-1"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{width:(row.value/max*100)+'%',background:colours[index%colours.length]}}/></div>{card.comparePrevious&&row.previousValue!==undefined&&<div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-400" style={{width:(row.previousValue/max*100)+'%'}}/></div>}</div>
      </div>)}
      {!rows.length&&<div className="py-12 text-center text-[10px] text-slate-400">No data available.</div>}
    </div>
    :card.chartType==='pie'?<div className="mt-5 flex min-h-[150px] flex-wrap items-center justify-center gap-6">
      <div className="h-32 w-32 shrink-0 rounded-full" style={{background:total?'conic-gradient('+pieStops.join(',')+')':'#edf1f7'}}>
        <div className="m-auto mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-500">{formatValue(total,card.displayFormat)}</div>
      </div>
      <div className="min-w-[120px] flex-1 space-y-2">{rows.slice(0,7).map((row,index)=><div key={row.label} className="flex items-center justify-between gap-3 text-[9px]">
        <span className="flex min-w-0 items-center gap-2 truncate text-slate-500"><i className="h-2 w-2 shrink-0 rounded-sm" style={{background:colours[index%colours.length]}}/>{row.label}</span><b className="shrink-0 text-slate-700 tabular-nums">{formatValue(row.value,card.displayFormat)}</b>
      </div>)}{!rows.length&&<p className="text-[10px] text-slate-400">No data available.</p>}</div>
    </div>
    :<div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
      {rows.slice(0,8).map(row=><div key={row.label} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-0"><span className="truncate text-[10px] font-medium text-slate-600">{row.label}</span><span className="text-[10px] font-bold tabular-nums text-[#17213d]">{formatValue(row.value,card.displayFormat)}{card.comparePrevious&&row.previousValue!==undefined&&<small className="ml-2 font-medium text-slate-400">vs {formatValue(row.previousValue,card.displayFormat)}</small>}</span></div>)}
      {!rows.length&&<div className="p-5 text-center text-[10px] text-slate-400">No rows available.</div>}
    </div>}
    {preview?.note&&<p className="mt-3 border-t border-slate-100 pt-2 text-[9px] text-amber-600">{preview.note}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-[8px] text-slate-400"><span>{card.groupBy==='none'?'Single metric':'Grouped by '+card.groupBy}</span>{card.comparePrevious&&<><span>·</span><span>Compare previous period</span></>}<span className="ml-auto">AI configured</span></div>
  </section>;
};

interface Props { tenantId: string; canUseAi: boolean; }

export const DashboardAiCards:React.FC<Props>=({tenantId, canUseAi})=>{
  const [cards,setCards]=useState<DashboardCard[]>([]);
  const [previews,setPreviews]=useState<Record<string,CardPreview>>({});
  const [loading,setLoading]=useState(true);
  const [open,setOpen]=useState(false);
  const [prompt,setPrompt]=useState('');
  const [generated,setGenerated]=useState<DashboardCard|null>(null);
  const [generatedPreview,setGeneratedPreview]=useState<CardPreview|null>(null);
  const [generating,setGenerating]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [refreshToken,setRefreshToken]=useState(0);

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const response=await fetch('/api/dashboard/cards');
        const payload=await response.json().catch(()=>({}));
        if(!response.ok||!payload?.success)throw new Error(payload?.error||'Could not load saved dashboard cards.');
        const saved=Array.isArray(payload.cards)?payload.cards as DashboardCard[]:[];
        if(active){
          setCards(saved);
          setPreviews(payload.previews && typeof payload.previews==='object' ? payload.previews as Record<string,CardPreview> : {});
          setError('');
        }
      }catch(err:any){if(active)setError(err?.message||'Could not load dashboard cards.');}
      finally{if(active)setLoading(false);}
    };
    void load();
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},90_000);
    window.addEventListener('focus',load);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('focus',load);};
  },[tenantId,refreshToken]);

  const generate=async()=>{
    if(prompt.trim().length<8){setError('Describe your metric or insight in at least 8 characters.');return;}
    setGenerating(true);setError('');setGenerated(null);setGeneratedPreview(null);
    try{
      const response=await fetch('/api/dashboard/cards/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt.trim()})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.card)throw new Error(payload?.error||'AI could not generate this card.');
      const card=payload.card as DashboardCard;
      const previewResponse=await fetch('/api/dashboard/cards/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card})});
      const previewPayload=await previewResponse.json().catch(()=>({}));
      if(!previewResponse.ok||!previewPayload?.preview)throw new Error(previewPayload?.error||'The AI configuration was generated, but its preview could not be calculated.');
      setGenerated(card);setGeneratedPreview(previewPayload.preview as CardPreview);
    }catch(err:any){setError(err?.message||'Something went wrong while generating the preview.');}
    finally{setGenerating(false);}
  };

  const save=async()=>{
    if(!generated||!generatedPreview)return;
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/dashboard/cards/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card:generated})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.success)throw new Error(payload?.error||'Could not save this dashboard card.');
      setCards(Array.isArray(payload.cards)?payload.cards as DashboardCard[]:[...cards,generated]);
      setPreviews(current=>({...current,[generated.id]:generatedPreview}));
      setOpen(false);setPrompt('');setGenerated(null);setGeneratedPreview(null);
    }catch(err:any){setError(err?.message||'Could not save this dashboard card.');}
    finally{setSaving(false);}
  };

  const remove=async(id:string)=>{
    try{
      const response=await fetch('/api/dashboard/cards/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardId:id})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.success)throw new Error(payload?.error||'Could not remove this card.');
      setCards(Array.isArray(payload.cards)?payload.cards as DashboardCard[]:cards.filter(card=>card.id!==id));
      setPreviews(current=>{const next={...current};delete next[id];return next;});
    }catch(err:any){setError(err?.message||'Could not remove this dashboard card.');}
  };

  const ordered=[...cards].sort((a,b)=>{
    const order={top:0,middle:1,bottom:2};
    return order[a.placement]-order[b.placement]||String(a.createdAt).localeCompare(String(b.createdAt));
  });

  return <section className="dashboard-ai-cards space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="dashboard-ai-section-heading text-[15px] font-bold tracking-[-.025em] text-[#080b32]">Your dashboard cards</h2><p className="dashboard-ai-section-description mt-1 text-[11px] text-slate-400">AI creates the visualization and every card setting from your prompt, using this workspace’s live data.</p></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={()=>setRefreshToken(value=>value+1)} title="Refresh dashboard cards" aria-label="Refresh dashboard cards" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#b9caff] hover:bg-[#f3f6ff] hover:text-[#0848ef]"><RefreshCw className="h-3.5 w-3.5"/></button>
        {canUseAi && <button type="button" onClick={()=>{setOpen(true);setError('');setGenerated(null);setGeneratedPreview(null);}} className="inline-flex items-center gap-2 rounded-lg bg-[#155eef] px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-[#0d4ed6]"><Plus className="h-3.5 w-3.5"/>Add card with AI</button>}
      </div>
    </div>
    {loading?<div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[11px] text-slate-400"><Activity className="mx-auto mb-2 h-5 w-5 animate-pulse text-[#0848ef]"/>Loading your saved dashboard cards…</div>
    :cards.length?<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{ordered.map(card=><VisualCard key={card.id} card={card} preview={previews[card.id]} onRemove={canUseAi ? remove : undefined}/>)}</div>
    :canUseAi ? <button type="button" onClick={()=>{setOpen(true);setError('');}} className="group flex min-h-[145px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#b9caff] bg-white px-5 py-7 text-center transition hover:border-[#0848ef] hover:bg-[#f8faff]">
      <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#eaf0ff] text-[#0848ef] transition group-hover:scale-105"><Plus className="h-5 w-5"/></span>
      <span className="text-[13px] font-bold text-[#17213d]">Create your first AI dashboard card</span>
      <span className="mt-1 max-w-md text-[10px] text-slate-400">Describe the metric, trend or comparison. AI chooses the chart, filters, date range and layout.</span>
    </button> : <div className="flex min-h-[145px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-[#0a0a2a] px-5 py-7 text-center">
      <span className="text-[12px] font-bold text-slate-100">No custom dashboard cards yet</span>
      <span className="mt-1 max-w-md text-[10px] text-slate-400">Ask your workspace administrator to enable AI dashboard customization.</span>
    </div>}
    {error&&!open&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">{error}</div>}

    {open&&canUseAi&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05051f]/65 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="dashboard-card-builder-title">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl">
        <div className="relative overflow-hidden bg-[#05051f] px-5 py-5 text-white sm:px-7 sm:py-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(164,76,232,.85),transparent_42%),radial-gradient(circle_at_85%_0%,rgba(8,125,239,.85),transparent_48%)] opacity-90"/>
          <div className="relative flex items-start justify-between gap-4"><div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.12em] text-blue-100"><Sparkles className="h-3 w-3"/>AI dashboard builder</span>
            <h2 id="dashboard-card-builder-title" className="mt-3 text-xl font-bold tracking-[-.035em] sm:text-2xl">What would you like to measure?</h2>
            <p className="mt-1 max-w-xl text-[11px] text-blue-100/80">Describe the insight. AI will choose the metric, chart, date range, filters, comparison, display format, width and placement.</p>
          </div><button type="button" onClick={()=>setOpen(false)} aria-label="Close card builder" className="rounded-lg border border-white/20 p-2 text-white/75 transition hover:bg-white/10 hover:text-white"><X className="h-4 w-4"/></button></div>
        </div>
        <div className="max-h-[78vh] space-y-4 overflow-y-auto p-4 sm:p-6">
          <div><label htmlFor="dashboard-card-prompt" className="mb-2 block text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Describe your dashboard card</label>
            <textarea id="dashboard-card-prompt" rows={3} value={prompt} onChange={event=>{setPrompt(event.target.value);setError('');}} placeholder="Example: Show how many new leads we generated each month over the last six months, compare it with the previous six months, and display it as a line chart." className="w-full resize-y rounded-xl border border-slate-200 bg-[#fbfcff] p-3 text-[12px] leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#8eafff] focus:bg-white focus:ring-4 focus:ring-blue-100" maxLength={500}/>
            <div className="mt-1 flex justify-between text-[9px] text-slate-400"><span>AI infers all card settings from this request.</span><span>{prompt.length}/500</span></div>
          </div>
          <div className="flex flex-wrap gap-2">{[
            'Show new leads by month for the last 6 months',
            'Compare conversations across channels',
            'Show campaign delivery status',
            'Show campaign email open rate for the last 30 days',
          ].map(example=><button key={example} type="button" onClick={()=>{setPrompt(example);setGenerated(null);setGeneratedPreview(null);setError('');}} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-medium text-slate-600 transition hover:border-[#b9caff] hover:bg-[#f3f6ff] hover:text-[#0848ef]">{example}</button>)}</div>
          {error&&<div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] text-rose-700">{error}</div>}
          {generating&&<div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-4"><Activity className="h-5 w-5 animate-pulse text-[#0848ef]"/><div><p className="text-[11px] font-bold text-[#17213d]">AI is designing your card</p><p className="mt-0.5 text-[9px] text-slate-500">Selecting a supported metric and visual, then calculating a tenant-scoped preview.</p></div></div>}
          {generated&&generatedPreview&&<div className="space-y-3 rounded-xl border border-[#dfe5f0] bg-[#f8faff] p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-bold text-[#17213d]">AI-generated configuration</p><p className="mt-0.5 text-[9px] text-slate-400">All settings below were inferred from your prompt.</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700">Preview ready</span></div>
            <div className="flex flex-wrap gap-1.5">{[
              generated.chartType.toUpperCase(),RANGE_LABEL[generated.dateRange],generated.groupBy==='none'?'Single metric':'By '+generated.groupBy,
              generated.comparePrevious?'Compare previous period':'No comparison',generated.displayFormat,generated.width+' card',generated.placement+' placement',
              ...(generated.filters.statuses||[]).map(value=>value.replaceAll('_',' ')),...(generated.filters.channels||[]),
            ].map((label,index)=><span key={index} className="rounded-md border border-[#dfe6f3] bg-white px-2 py-1 text-[8px] font-semibold capitalize text-slate-600">{label}</span>)}</div>
            <VisualCard card={generated} preview={generatedPreview}/>
            <p className="text-[9px] text-slate-400">Preview uses this workspace’s records only. Saved cards refresh when the dashboard loads.</p>
          </div>}
          <div className="flex flex-col-reverse justify-between gap-2 border-t border-slate-100 pt-4 sm:flex-row">
            <button type="button" onClick={()=>{setGenerated(null);setGeneratedPreview(null);setError('');}} disabled={generating||saving} className="rounded-lg border border-slate-200 px-4 py-2.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">Refine prompt</button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" onClick={generate} disabled={generating||saving||prompt.trim().length<8} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#cbd8ff] bg-[#f3f6ff] px-4 py-2.5 text-[10px] font-bold text-[#0848ef] transition hover:bg-[#eaf0ff] disabled:cursor-not-allowed disabled:opacity-50"><Sparkles className="h-3.5 w-3.5"/>{generated?'Regenerate with AI':'Generate preview'}</button>
              {generated&&<button type="button" onClick={save} disabled={saving||generating} className="rounded-lg bg-[#0848ef] px-4 py-2.5 text-[10px] font-bold text-white shadow-sm transition hover:bg-[#063bc7] disabled:opacity-50">{saving?'Saving…':'Save to dashboard'}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>}
  </section>;
};
