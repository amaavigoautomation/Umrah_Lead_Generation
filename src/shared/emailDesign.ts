export type EmailDesignBlockType = 'logo' | 'heading' | 'text' | 'content' | 'image' | 'button' | 'divider' | 'spacer' | 'footer' | 'social';
export type EmailDesignSource = 'PREDEFINED' | 'CUSTOM' | 'AI';
export interface EmailDesignTheme {
  pageBackground:string; cardBackground:string; primaryColor:string; accentColor:string;
  textColor:string; mutedColor:string; fontFamily:string; contentWidth:number; cardRadius:number;
}
export interface EmailDesignBlock {
  id:string; type:EmailDesignBlockType; text?:string; url?:string; altText?:string;
  align?:'left'|'center'|'right'; width?:number; fontSize?:number; color?:string;
  backgroundColor?:string; padding?:number; enabled?:boolean;
  links?:Array<{label:string;url:string}>;
}
export interface EmailBrandProfile {
  websiteUrl:string; companyName:string; tagline:string; description:string; logoUrl:string;
  contactEmail:string; contactPhone:string; colors:string[]; socialLinks:Record<string,string>;
}
export interface EmailDesignTemplate {
  id:string; name:string; description:string; category:string; source:EmailDesignSource; version:number;
  theme:EmailDesignTheme; blocks:EmailDesignBlock[]; customHtml?:string; brandProfile?:EmailBrandProfile;
  createdAt?:string; updatedAt?:string;
}
export const DEFAULT_EMAIL_DESIGN_ID = 'modern-professional';
export const DEFAULT_EMAIL_DESIGN_THEME:EmailDesignTheme = {
  pageBackground:'#F3F5F8', cardBackground:'#FFFFFF', primaryColor:'#183B66', accentColor:'#E68A35',
  textColor:'#263445', mutedColor:'#718096', fontFamily:'Arial, Helvetica, sans-serif', contentWidth:600, cardRadius:12,
};
let blockCounter=0;
export function createEmailDesignBlockId(prefix='block'):string {
  blockCounter += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + blockCounter.toString(36);
}
const b=(id:string,type:EmailDesignBlockType,options:Partial<EmailDesignBlock>={}):EmailDesignBlock=>({id,type,enabled:true,...options});
const p=(id:string,name:string,description:string,category:string,theme:Partial<EmailDesignTheme>,blocks:EmailDesignBlock[]):EmailDesignTemplate=>({
  id,name,description,category,source:'PREDEFINED',version:1,theme:{...DEFAULT_EMAIL_DESIGN_THEME,...theme},blocks,
});
export const PREDEFINED_EMAIL_DESIGNS:EmailDesignTemplate[] = [
 p('modern-professional','Modern Professional','A polished, versatile business email with a confident brand header, generous whitespace and a clear reading hierarchy.','Business',
  {primaryColor:'#183B66',accentColor:'#E68A35'},[
   b('logo','logo',{align:'left',width:168,padding:28}),b('rule-top','divider',{color:'#E7ECF2',padding:0}),
   b('heading','heading',{text:'A note from {{companyName}}',fontSize:22,color:'#183B66',padding:24}),
   b('content','content',{padding:8}),b('rule-bottom','divider',{color:'#E7ECF2',padding:10}),b('footer','footer',{padding:24}),
  ]),
 p('executive-minimal','Executive Minimal','Understated, editorial correspondence for executive conversations and high-trust B2B relationships.','Minimal',
  {primaryColor:'#202A35',accentColor:'#A88B5B',pageBackground:'#F7F7F5',contentWidth:620,cardRadius:4,fontFamily:'Georgia, Times New Roman, serif'},[
   b('logo','logo',{align:'left',width:150,padding:34}),b('heading','heading',{text:'A personal note',fontSize:24,color:'#202A35',padding:24}),
   b('content','content',{padding:8}),b('rule','divider',{color:'#E7E3DC',padding:18}),b('footer','footer',{padding:26}),
  ]),
 p('premium-concierge','Premium Concierge','A refined luxury and hospitality layout with deep navy, warm metallic accents and elegant spacing.','Luxury & Hospitality',
  {pageBackground:'#101A2A',cardBackground:'#17263B',primaryColor:'#D9B77A',accentColor:'#E6C98D',textColor:'#F3F0E9',mutedColor:'#B9C3D0',fontFamily:'Georgia, Times New Roman, serif',contentWidth:620,cardRadius:3},[
   b('logo','logo',{align:'center',width:180,padding:34}),b('rule','divider',{color:'#7B6745',padding:4}),
   b('heading','heading',{text:'A thoughtful note for you',fontSize:25,color:'#E6C98D',align:'center',padding:30}),
   b('content','content',{padding:12}),b('footer','footer',{align:'center',padding:32}),
  ]),
 p('saas-modern','SaaS Product Update','A crisp product-led design with a clear header and focused message area.','Technology',
  {primaryColor:'#273A8A',accentColor:'#5B7CFA',pageBackground:'#F4F6FC',textColor:'#273044',cardRadius:16},[
   b('logo','logo',{align:'left',width:154,padding:24}),b('label','text',{text:'CUSTOMER COMMUNICATION',fontSize:10,color:'#5B7CFA',padding:8}),
   b('heading','heading',{text:'Keeping your team moving forward',fontSize:23,color:'#273A8A',padding:14}),
   b('content','content',{padding:8}),b('footer','footer',{padding:22}),
  ]),
 p('warm-customer-care','Warm Customer Care','Friendly, reassuring and accessible, with soft colours and a human support tone.','Customer Support',
  {primaryColor:'#285C51',accentColor:'#D98B68',pageBackground:'#F5F7F3',textColor:'#34443F',mutedColor:'#71827B',cardRadius:18},[
   b('logo','logo',{align:'left',width:150,padding:26}),b('heading','heading',{text:'We are here to help',fontSize:23,color:'#285C51',padding:20}),
   b('content','content',{padding:8}),b('rule','divider',{color:'#E4EBE4',padding:18}),b('footer','footer',{padding:22}),
  ]),
 p('creative-studio','Creative Studio','A distinctive, contemporary style for agencies, studios and creative businesses.','Creative',
  {primaryColor:'#32265F',accentColor:'#E76F51',pageBackground:'#F3F0FA',textColor:'#332F40',mutedColor:'#777184',contentWidth:640,cardRadius:20},[
   b('logo','logo',{align:'left',width:160,padding:28}),b('accent','divider',{color:'#E76F51',padding:2}),
   b('heading','heading',{text:'Ideas, thoughtfully delivered.',fontSize:27,color:'#32265F',padding:22}),
   b('content','content',{padding:8}),b('footer','footer',{padding:26}),
  ]),
 p('classic-editorial','Classic Editorial','A timeless letter-style format with restrained typography and clear reading hierarchy.','Professional Services',
  {primaryColor:'#314454',accentColor:'#B88A58',pageBackground:'#F7F5F0',cardBackground:'#FFFEFB',textColor:'#303A40',mutedColor:'#7B817F',fontFamily:'Georgia, Times New Roman, serif',contentWidth:620,cardRadius:2},[
   b('logo','logo',{align:'center',width:160,padding:32}),b('rule','divider',{color:'#DDD6C9',padding:8}),
   b('heading','heading',{text:'Correspondence',fontSize:22,color:'#314454',align:'center',padding:20}),
   b('content','content',{padding:10}),b('footer','footer',{align:'center',padding:26}),
  ]),
 p('bold-business','Bold Business','A confident high-contrast design for important client communications.','Business',
  {primaryColor:'#111827',accentColor:'#F2A900',pageBackground:'#EEF1F5',textColor:'#273244',mutedColor:'#697586',cardRadius:8},[
   b('logo','logo',{align:'left',width:160,padding:26}),b('heading','heading',{text:'Moving business forward',fontSize:25,color:'#111827',padding:18}),
   b('accent','divider',{color:'#F2A900',padding:3}),b('content','content',{padding:14}),b('footer','footer',{padding:24}),
  ]),
 p('clean-healthcare','Clean & Reassuring','A calm, accessible layout for healthcare, wellness and service-led communications.','Healthcare & Wellness',
  {primaryColor:'#176B70',accentColor:'#55A6A0',pageBackground:'#F0F7F7',textColor:'#2D4548',mutedColor:'#70878A',cardRadius:14},[
   b('logo','logo',{align:'left',width:150,padding:26}),b('heading','heading',{text:'A clear update for you',fontSize:22,color:'#176B70',padding:18}),
   b('content','content',{padding:8}),b('footer','footer',{padding:24}),
  ]),
];
export const SAMPLE_EMAIL_CONTENT='Hello Alex,\n\nThank you for getting in touch. I would be happy to walk you through the details and help you identify the best next step for your team.\n\nPlease let me know a convenient time to connect.\n\nRegards,\nCustomer Success Team';
const fonts=['Arial, Helvetica, sans-serif','Helvetica, Arial, sans-serif','Georgia, Times New Roman, serif','Tahoma, Arial, sans-serif','Verdana, Geneva, sans-serif','Trebuchet MS, Arial, sans-serif'];
export function isSafeEmailUrl(value:unknown,allowRelative=true):string {
 const input=String(value??'').trim().slice(0,2048); if(!input)return '';
 if(allowRelative && /^\/api\/assets\/[a-zA-Z0-9_.-]+\/view$/.test(input))return input;
 if(/^mailto:[^\s<>]+$/i.test(input))return input;
 try {const url=new URL(input);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';return url.toString();}catch{return '';}
}
export function safeHexColor(value:unknown,fallback='#FFFFFF'):string {
 const color=String(value??'').trim();return /^#[0-9a-fA-F]{6}$/.test(color)?color.toUpperCase():fallback;
}
export function escapeEmailHtml(value:unknown):string {
 return String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
}
function num(v:unknown,d:number,min:number,max:number):number {const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(min,Math.min(max,n))):d;}
function safeStyle(style:string):string {
 const allowed=['color','background-color','font-family','font-size','font-weight','font-style','line-height','text-align','text-decoration','padding','padding-top','padding-right','padding-bottom','padding-left','margin','width','max-width','height','border','border-radius','border-collapse','vertical-align','display','letter-spacing'];
 return style.split(';').map((part)=>{const i=part.indexOf(':');if(i<1)return '';const key=part.slice(0,i).trim().toLowerCase();const value=part.slice(i+1).trim();if(!allowed.includes(key)||!value||/url\s*\(|expression|javascript:|@import|position\s*:/i.test(value))return '';return key+':'+value.slice(0,180);}).filter(Boolean).join(';');
}
export function sanitizeCustomEmailHtml(input:unknown):string {
 let html=String(input??'').slice(0,60000).replace(/<!--[\s\S]*?-->/g,'')
 .replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg|math|link|meta|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
 .replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg|math|link|meta|base)\b[^>]*\/?>/gi,'');
 const tags=new Set(['table','tbody','thead','tfoot','tr','td','th','div','span','p','br','strong','b','em','i','u','h1','h2','h3','h4','a','img','hr','ul','ol','li','blockquote']);
 return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,(full,rawTag:string,rawAttrs:string)=>{
  const tag=rawTag.toLowerCase();if(!tags.has(tag))return '';if(/^<\//.test(full))return '</'+tag+'>';
  const attrs:string[]=[];const pattern=/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;let m:RegExpExecArray|null;
  while((m=pattern.exec(rawAttrs))!==null){
   const name=m[1].toLowerCase(),value=m[2].replace(/^["']|["']$/g,'');
   if(name==='style'){const safe=safeStyle(value);if(safe)attrs.push('style="'+escapeEmailHtml(safe)+'"');}
   else if(['align','valign','width','height','cellpadding','cellspacing','border','colspan','rowspan','role','alt','title'].includes(name)&&/^[a-z0-9 #.,%_-]{0,160}$/i.test(value))attrs.push(name+'="'+escapeEmailHtml(value)+'"');
   else if(name==='href'&&tag==='a'){const safe=isSafeEmailUrl(value,false);if(safe)attrs.push('href="'+escapeEmailHtml(safe)+'"');}
   else if(name==='src'&&tag==='img'){const safe=isSafeEmailUrl(value,true);if(safe)attrs.push('src="'+escapeEmailHtml(safe)+'"');}
  }
  if(tag==='a')attrs.push('target="_blank" rel="noopener noreferrer"');
  if(tag==='img')attrs.push('border="0"');
  return '<'+tag+(attrs.length?' '+attrs.join(' '):'')+(['br','hr','img'].includes(tag)?' /':'')+'>';
 });
}
export function normalizeEmailDesignTemplate(input:any,sourceOverride?:EmailDesignSource):EmailDesignTemplate {
 const raw=input&&typeof input==='object'?input:{},rt=raw.theme&&typeof raw.theme==='object'?raw.theme:{};
 const theme:EmailDesignTheme={
  pageBackground:safeHexColor(rt.pageBackground,'#F3F5F8'),cardBackground:safeHexColor(rt.cardBackground,'#FFFFFF'),
  primaryColor:safeHexColor(rt.primaryColor,'#183B66'),accentColor:safeHexColor(rt.accentColor,'#E68A35'),
  textColor:safeHexColor(rt.textColor,'#263445'),mutedColor:safeHexColor(rt.mutedColor,'#718096'),
  fontFamily:fonts.includes(rt.fontFamily)?rt.fontFamily:fonts[0],contentWidth:num(rt.contentWidth,600,480,680),cardRadius:num(rt.cardRadius,12,0,24),
 };
 const types=new Set<EmailDesignBlockType>(['logo','heading','text','content','image','button','divider','spacer','footer','social']);
 const blocks:EmailDesignBlock[]=(Array.isArray(raw.blocks)?raw.blocks:[]).slice(0,40).map((item:any,i:number)=>{
  const type=types.has(item?.type)?item.type as EmailDesignBlockType:'text';
  return {id:String(item?.id||'block-'+i).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||'block-'+i,type,
   text:String(item?.text??'').slice(0,5000),url:isSafeEmailUrl(item?.url,true),altText:String(item?.altText??'').slice(0,240),
   align:['left','center','right'].includes(item?.align)?item.align:'left',width:num(item?.width,560,80,680),
   fontSize:num(item?.fontSize,type==='heading'?24:15,10,48),color:safeHexColor(item?.color,theme.textColor),
   backgroundColor:safeHexColor(item?.backgroundColor,theme.cardBackground),padding:num(item?.padding,16,0,64),
   enabled:item?.enabled!==false||type==='content',
   links:Array.isArray(item?.links)?item.links.slice(0,6).map((x:any)=>({label:String(x?.label||'').slice(0,40),url:isSafeEmailUrl(x?.url,false)})).filter((x:any)=>x.label&&x.url):undefined};
 });
 if(!blocks.some(x=>x.type==='content'))blocks.push({id:'content-area',type:'content',padding:16,enabled:true});
 const source=sourceOverride||(['PREDEFINED','CUSTOM','AI'].includes(raw.source)?raw.source:'CUSTOM');
 const brand=raw.brandProfile&&typeof raw.brandProfile==='object'?raw.brandProfile:undefined;
 const brandProfile:EmailBrandProfile|undefined=brand?{
  websiteUrl:isSafeEmailUrl(brand.websiteUrl,false),companyName:String(brand.companyName||'').slice(0,120),tagline:String(brand.tagline||'').slice(0,180),
  description:String(brand.description||'').slice(0,1200),logoUrl:isSafeEmailUrl(brand.logoUrl,true),contactEmail:String(brand.contactEmail||'').slice(0,180),
  contactPhone:String(brand.contactPhone||'').slice(0,80),colors:Array.isArray(brand.colors)?brand.colors.map((x:unknown)=>safeHexColor(x,'')).filter(Boolean).slice(0,6):[],
  socialLinks:Object.fromEntries(Object.entries(brand.socialLinks||{}).slice(0,8).map(([k,v])=>[String(k).slice(0,30),isSafeEmailUrl(v,false)]).filter((x)=>x[1]))}:undefined;
 let customHtml=raw.customHtml?sanitizeCustomEmailHtml(raw.customHtml):'';
 if(customHtml&&!customHtml.includes('{{content}}'))customHtml+='<div style="padding:20px">{{content}}</div>';
 return {id:String(raw.id||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100),name:String(raw.name||'Untitled email design').trim().slice(0,100)||'Untitled email design',
  description:String(raw.description||'').trim().slice(0,280),category:String(raw.category||'Business').slice(0,60),source,version:num(raw.version,1,1,10000),
  theme,blocks,...(customHtml?{customHtml}:{}),...(brandProfile?{brandProfile}:{}),
  ...(raw.createdAt?{createdAt:String(raw.createdAt).slice(0,40)}:{}),...(raw.updatedAt?{updatedAt:String(raw.updatedAt).slice(0,40)}:{})};
}
function textHtml(text:string):string {
 return text.split(/\r?\n\r?\n/).map(p=>'<p style="margin:0 0 17px 0;line-height:1.72">'+p.split(/\r?\n/).map(escapeEmailHtml).join('<br/>')+'</p>').join('');
}
function renderBlock(item:EmailDesignBlock,t:EmailDesignTemplate,body:string,brand:Record<string,any>):string {
 if(item.enabled===false&&item.type!=='content')return '';
 const th=t.theme,align=item.align||'left',color=safeHexColor(item.color,th.textColor),pad=num(item.padding,16,0,64);
 const wrap=(content:string,style='')=>'<tr><td align="'+align+'" style="padding:'+pad+'px 28px;'+style+'">'+content+'</td></tr>';
 const label=String(item.text||'').replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team')).replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''));
 switch(item.type){
  case 'logo':{
   const logo=isSafeEmailUrl(item.url,true)||isSafeEmailUrl(brand.logoUrl,true),company=escapeEmailHtml(brand.companyName||'Our Team');
   return wrap(logo?'<img src="'+escapeEmailHtml(logo)+'" alt="'+escapeEmailHtml(item.altText||company)+'" width="'+num(item.width,180,80,320)+'" style="display:inline-block;max-width:100%;height:auto;border:0"/>':'<span style="font-size:22px;font-weight:700;color:'+th.primaryColor+'">'+company+'</span>','padding-top:24px;padding-bottom:20px;');
  }
  case 'heading':return wrap('<h1 style="margin:0;color:'+color+';font-family:'+th.fontFamily+';font-size:'+num(item.fontSize,24,10,48)+'px;line-height:1.28;font-weight:700">'+escapeEmailHtml(label||'A message for you')+'</h1>');
  case 'text':return wrap('<div style="font-family:'+th.fontFamily+';font-size:'+num(item.fontSize,14,10,48)+'px;line-height:1.65;color:'+color+'">'+escapeEmailHtml(label).replace(/\n/g,'<br/>')+'</div>');
  case 'content':return '<tr><td align="left" style="padding:'+pad+'px 36px 24px 36px;font-family:'+th.fontFamily+';font-size:15px;color:'+th.textColor+';line-height:1.72">'+body+'</td></tr>';
  case 'image':{const src=isSafeEmailUrl(item.url,true);if(!src)return '';const width=Math.min(th.contentWidth,num(item.width,th.contentWidth-56,80,680));return wrap('<img src="'+escapeEmailHtml(src)+'" alt="'+escapeEmailHtml(item.altText||'')+'" width="'+width+'" style="display:block;width:100%;max-width:'+width+'px;height:auto;border:0;border-radius:8px;margin:0 auto"/>','padding-top:10px;padding-bottom:10px;');}
  case 'button':{const href=isSafeEmailUrl(item.url,false);if(!href)return '';return wrap('<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="'+align+'"><tr><td bgcolor="'+th.primaryColor+'" style="border-radius:7px;background:'+th.primaryColor+'"><a href="'+escapeEmailHtml(href)+'" target="_blank" style="display:inline-block;padding:13px 22px;color:#FFFFFF;text-decoration:none;font-family:'+th.fontFamily+';font-size:14px;font-weight:700">'+escapeEmailHtml(label||'Learn more')+'</a></td></tr></table>');}
  case 'divider':return wrap('<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="1" style="height:1px;background:'+safeHexColor(item.color,'#E6EAF0')+';font-size:0;line-height:0">&nbsp;</td></tr></table>','padding-top:8px;padding-bottom:8px;');
  case 'spacer':return '<tr><td height="'+num(item.padding,24,4,80)+'" style="height:'+num(item.padding,24,4,80)+'px;font-size:0;line-height:0">&nbsp;</td></tr>';
  case 'footer':{
   const company=escapeEmailHtml(brand.companyName||'Our Team'),website=isSafeEmailUrl(brand.websiteUrl,false);
   const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(brand.salesEmail||brand.contactEmail||''))?String(brand.salesEmail||brand.contactEmail):'';
   const phone=String(brand.supportPhone||brand.contactPhone||'').slice(0,80);
   return '<tr><td align="'+align+'" style="padding:'+pad+'px 28px 28px 28px;background:'+th.pageBackground+';font-family:'+th.fontFamily+';color:'+th.mutedColor+';font-size:12px;line-height:1.7"><strong style="color:'+th.textColor+';font-size:13px">'+company+'</strong>'+(brand.tagline?'<br/>'+escapeEmailHtml(brand.tagline):'')+(email?'<br/><a href="mailto:'+escapeEmailHtml(email)+'" style="color:'+th.primaryColor+';text-decoration:none">'+escapeEmailHtml(email)+'</a>':'')+(phone?'<br/>'+escapeEmailHtml(phone):'')+(website?'<br/><a href="'+escapeEmailHtml(website)+'" style="color:'+th.primaryColor+';text-decoration:none">'+escapeEmailHtml(website.replace(/^https?:\/\//,'').replace(/\/$/,''))+'</a>':'')+'<br/><span style="font-size:10px;color:'+th.mutedColor+'">You are receiving this message because you have an existing conversation with '+company+'.</span></td></tr>';
  }
  case 'social':{const links=(item.links||[]).filter(x=>x.label&&isSafeEmailUrl(x.url,false));return links.length?wrap(links.map(x=>'<a href="'+escapeEmailHtml(x.url)+'" style="display:inline-block;margin:0 8px;color:'+th.primaryColor+';font-size:12px;text-decoration:underline">'+escapeEmailHtml(x.label)+'</a>').join('')):'';}
  default:return '';
 }
}
export function renderEmailDesignHtml(input:EmailDesignTemplate,messageText:string,brandInput:Record<string,any>={},baseUrl=''):string {
 const t=normalizeEmailDesignTemplate(input),brand={...brandInput,...(t.brandProfile||{})},body=textHtml(String(messageText||''));
 if(t.customHtml){
  const custom=sanitizeCustomEmailHtml(t.customHtml).replace(/\{\{content\}\}/g,body)
   .replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team'))
   .replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''))
   .replace(/\{\{websiteUrl\}\}/g,escapeEmailHtml(isSafeEmailUrl(brand.websiteUrl,false)));
  return '<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:'+t.theme.pageBackground+'"><div style="max-width:'+t.theme.contentWidth+'px;margin:0 auto">'+custom+'</div></body></html>';
 }
 const blocks=t.blocks.map(x=>renderBlock(x,t,body,brand)).join(''),base=isSafeEmailUrl(baseUrl,false);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="x-apple-disable-message-reformatting"/><title>'+escapeEmailHtml(t.name)+'</title></head><body style="margin:0;padding:0;background:'+t.theme.pageBackground+';-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="'+t.theme.pageBackground+'" style="width:100%;background:'+t.theme.pageBackground+'"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="'+t.theme.contentWidth+'" cellspacing="0" cellpadding="0" border="0" bgcolor="'+t.theme.cardBackground+'" style="width:100%;max-width:'+t.theme.contentWidth+'px;background:'+t.theme.cardBackground+';border-radius:'+t.theme.cardRadius+'px;border-collapse:separate;overflow:hidden"><tr><td style="font-family:'+t.theme.fontFamily+';color:'+t.theme.textColor+'"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'+blocks+'</table></td></tr></table><table role="presentation" width="'+t.theme.contentWidth+'" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:'+t.theme.contentWidth+'px"><tr><td align="center" style="padding:12px 10px;color:'+t.theme.mutedColor+';font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5">'+(base?'<a href="'+escapeEmailHtml(base)+'" style="color:'+t.theme.mutedColor+';text-decoration:none">'+escapeEmailHtml(base.replace(/^https?:\/\//,'').replace(/\/$/,''))+'</a>':'')+'</td></tr></table></td></tr></table></body></html>';
}
export function createBlankEmailDesignTemplate():EmailDesignTemplate {
 return {id:'',name:'My custom email design',description:'A custom email design created from scratch.',category:'Custom',source:'CUSTOM',version:1,theme:{...DEFAULT_EMAIL_DESIGN_THEME},
  blocks:[b(createEmailDesignBlockId('logo'),'logo',{align:'left',width:160,padding:26}),b(createEmailDesignBlockId('heading'),'heading',{text:'A message for you',fontSize:24,padding:20}),b(createEmailDesignBlockId('content'),'content',{padding:16}),b(createEmailDesignBlockId('footer'),'footer',{padding:24})]};
}
