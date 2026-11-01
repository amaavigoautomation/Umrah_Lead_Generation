export type EmailDesignBlockType = 'logo' | 'hero' | 'heading' | 'text' | 'content' | 'image' | 'button' | 'divider' | 'spacer' | 'footer' | 'social';
export type EmailDesignSource = 'PREDEFINED' | 'CUSTOM' | 'AI';
export interface EmailDesignTheme {
  pageBackground:string; cardBackground:string; primaryColor:string; accentColor:string;
  textColor:string; mutedColor:string; fontFamily:string; contentWidth:number; cardRadius:number;
  headingFontSize:number; bodyFontSize:number; bodyLineHeight:number;
}
export interface EmailDesignBlock {
  id:string; type:EmailDesignBlockType; text?:string; url?:string; altText?:string;
  align?:'left'|'center'|'right'; width?:number; fontSize?:number; color?:string;
  backgroundColor?:string; padding?:number; enabled?:boolean; eyebrow?:string; secondaryText?:string;
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
  /** Campaign email metadata; unused by conversation reply designs. */
  campaignTemplateId?:string; campaignSubject?:string; campaignPreheader?:string; campaignBody?:string; campaignAttachments?:any[];
}
export const DEFAULT_EMAIL_DESIGN_ID = 'modern-professional';
export const DEFAULT_EMAIL_DESIGN_THEME:EmailDesignTheme = {
  pageBackground:'#F3F5F8', cardBackground:'#FFFFFF', primaryColor:'#183B66', accentColor:'#E68A35',
  textColor:'#263445', mutedColor:'#718096', fontFamily:'Arial, Helvetica, sans-serif', contentWidth:600, cardRadius:12,
  headingFontSize:28, bodyFontSize:15, bodyLineHeight:1.72,
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
 p('modern-professional','Modern Professional','Confident business email with a branded header, editorial hero, clear message area and refined footer.','Business',
  {primaryColor:'#173B63',accentColor:'#D97842',pageBackground:'#F2F5F9',cardBackground:'#FFFFFF',textColor:'#25364A',mutedColor:'#718096',headingFontSize:29,bodyFontSize:15,bodyLineHeight:1.75,cardRadius:14},[
   b('brand-header','logo',{align:'left',width:170,padding:24,backgroundColor:'#FFFFFF',color:'#173B63'}),
   b('hero','hero',{eyebrow:'A NOTE FROM {{companyName}}',text:'A better way to move business forward',secondaryText:'Clear updates, thoughtful ideas and the next step for your team.',fontSize:29,align:'left',padding:30,backgroundColor:'#EAF1F8',color:'#173B63'}),
   b('content','content',{padding:10}),b('primary-cta','button',{text:'Explore the next step',align:'left',padding:12,backgroundColor:'#173B63',color:'#FFFFFF'}),
   b('footer','footer',{padding:24,backgroundColor:'#F2F5F9',color:'#718096'}),
  ]),
 p('executive-minimal','Executive Minimal','Understated, letter-style design for founder, leadership and high-trust B2B communication.','Executive',
  {primaryColor:'#202B36',accentColor:'#B18B59',pageBackground:'#F7F6F2',cardBackground:'#FFFEFB',textColor:'#303A42',mutedColor:'#7B817B',fontFamily:'Georgia, Times New Roman, serif',contentWidth:620,cardRadius:3,headingFontSize:30,bodyFontSize:16,bodyLineHeight:1.8},[
   b('brand-header','logo',{align:'left',width:145,padding:30,backgroundColor:'#FFFEFB',color:'#202B36'}),b('top-rule','divider',{color:'#DCD6CA',padding:2}),
   b('hero','hero',{eyebrow:'PERSONAL CORRESPONDENCE',text:'A thoughtful note',secondaryText:'A considered perspective for our next conversation.',fontSize:30,align:'left',padding:24,backgroundColor:'#F3F0E9',color:'#202B36'}),
   b('content','content',{padding:12}),b('footer','footer',{padding:26,backgroundColor:'#F3F0E9',color:'#77756F'}),
  ]),
 p('premium-concierge','Premium Concierge','Sophisticated hospitality and luxury layout with deep ink tones, warm metallic accents and generous spacing.','Luxury & Hospitality',
  {pageBackground:'#101927',cardBackground:'#18263A',primaryColor:'#C7A56B',accentColor:'#E4C58D',textColor:'#F3F0E8',mutedColor:'#B7C0CA',fontFamily:'Georgia, Times New Roman, serif',contentWidth:620,cardRadius:3,headingFontSize:30,bodyFontSize:15,bodyLineHeight:1.8},[
   b('brand-header','logo',{align:'center',width:180,padding:30,backgroundColor:'#18263A',color:'#E4C58D'}),
   b('hero','hero',{eyebrow:'A PERSONALIZED EXPERIENCE',text:'Consider every detail taken care of',secondaryText:'Exceptional service begins with a thoughtful welcome.',fontSize:30,align:'center',padding:34,backgroundColor:'#24364D',color:'#F2DFC0'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Discover your experience',align:'center',padding:18,backgroundColor:'#C7A56B',color:'#172336'}),
   b('footer','footer',{align:'center',padding:28,backgroundColor:'#101927',color:'#B7C0CA'}),
  ]),
 p('saas-modern','SaaS Product Update','Product-led design with a clear feature announcement, readable copy and high-contrast action.','Technology',
  {primaryColor:'#3446A5',accentColor:'#667BFA',pageBackground:'#F3F5FC',cardBackground:'#FFFFFF',textColor:'#29334B',mutedColor:'#737D98',cardRadius:16,headingFontSize:28,bodyFontSize:15,bodyLineHeight:1.7},[
   b('brand-header','logo',{align:'left',width:154,padding:22,backgroundColor:'#FFFFFF',color:'#3446A5'}),
   b('hero','hero',{eyebrow:'PRODUCT UPDATE',text:'More clarity. Less busywork.',secondaryText:'A better way for your team to stay focused and keep work moving.',fontSize:29,align:'left',padding:28,backgroundColor:'#EEF1FF',color:'#263987'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'See what is new',align:'left',padding:14,backgroundColor:'#5266DA',color:'#FFFFFF'}),
   b('footer','footer',{padding:22,backgroundColor:'#F3F5FC',color:'#737D98'}),
  ]),
 p('warm-customer-care','Warm Customer Care','Approachable, reassuring customer email with gentle colour, friendly typography and clear support details.','Customer Support',
  {primaryColor:'#28665D',accentColor:'#D58E70',pageBackground:'#F3F7F4',cardBackground:'#FFFFFF',textColor:'#344741',mutedColor:'#74857D',cardRadius:18,headingFontSize:27,bodyFontSize:15,bodyLineHeight:1.78},[
   b('brand-header','logo',{align:'left',width:150,padding:24,backgroundColor:'#FFFFFF',color:'#28665D'}),
   b('hero','hero',{eyebrow:'WE ARE HERE FOR YOU',text:'How can we make things easier?',secondaryText:'A friendly update from a team that is always happy to help.',fontSize:27,align:'left',padding:26,backgroundColor:'#E7F1EC',color:'#20584F'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Talk to our team',align:'left',padding:12,backgroundColor:'#28665D',color:'#FFFFFF'}),
   b('footer','footer',{padding:24,backgroundColor:'#F3F7F4',color:'#74857D'}),
  ]),
 p('creative-studio','Creative Studio','Expressive design for agencies and creative teams, balancing colour, oversized type and whitespace.','Creative',
  {primaryColor:'#34245E',accentColor:'#F07859',pageBackground:'#F4F0FA',cardBackground:'#FFFFFF',textColor:'#332D43',mutedColor:'#777187',contentWidth:640,cardRadius:18,headingFontSize:32,bodyFontSize:15,bodyLineHeight:1.72},[
   b('brand-header','logo',{align:'left',width:160,padding:25,backgroundColor:'#FFFFFF',color:'#34245E'}),
   b('hero','hero',{eyebrow:'IDEAS IN MOTION',text:'Make your next big idea happen.',secondaryText:'A fresh perspective, a little momentum and a creative partner for what comes next.',fontSize:32,align:'left',padding:32,backgroundColor:'#34245E',color:'#FFFFFF'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Let us create together',align:'left',padding:14,backgroundColor:'#F07859',color:'#FFFFFF'}),
   b('footer','footer',{padding:24,backgroundColor:'#EEE9F5',color:'#777187'}),
  ]),
 p('classic-editorial','Classic Editorial','Publication-inspired design with restrained typography and a calm reading experience.','Newsletter',
  {primaryColor:'#334C5D',accentColor:'#B68B5B',pageBackground:'#F5F2EB',cardBackground:'#FFFEFA',textColor:'#303A40',mutedColor:'#7C817E',fontFamily:'Georgia, Times New Roman, serif',contentWidth:620,cardRadius:2,headingFontSize:30,bodyFontSize:16,bodyLineHeight:1.85},[
   b('brand-header','logo',{align:'center',width:160,padding:28,backgroundColor:'#FFFEFA',color:'#334C5D'}),b('top-rule','divider',{color:'#D9D1C4',padding:2}),
   b('hero','hero',{eyebrow:'THE MONTHLY EDITION',text:'Ideas worth your time.',secondaryText:'A considered selection of updates, insights and perspectives.',fontSize:30,align:'center',padding:26,backgroundColor:'#F1EDE4',color:'#334C5D'}),
   b('content','content',{padding:14}),b('bottom-rule','divider',{color:'#D9D1C4',padding:8}),b('footer','footer',{align:'center',padding:24,backgroundColor:'#F1EDE4',color:'#7C817E'}),
  ]),
 p('bold-business','Bold Business','High-contrast campaign design for important announcements, strong offers and decisive calls to action.','Business',
  {primaryColor:'#161B27',accentColor:'#F2B544',pageBackground:'#EEF0F3',cardBackground:'#FFFFFF',textColor:'#273244',mutedColor:'#6D7787',cardRadius:8,headingFontSize:31,bodyFontSize:15,bodyLineHeight:1.7},[
   b('brand-header','logo',{align:'left',width:160,padding:24,backgroundColor:'#161B27',color:'#FFFFFF'}),
   b('hero','hero',{eyebrow:'BUILT FOR WHAT IS NEXT',text:'Big goals deserve bold action.',secondaryText:'Make the next move with a partner focused on measurable progress.',fontSize:31,align:'left',padding:30,backgroundColor:'#F2B544',color:'#161B27'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Take the next step',align:'left',padding:14,backgroundColor:'#161B27',color:'#FFFFFF'}),
   b('footer','footer',{padding:22,backgroundColor:'#EEF0F3',color:'#6D7787'}),
  ]),
 p('clean-healthcare','Clean & Reassuring','Accessible, calm design for healthcare, wellness and service-led customer communication.','Healthcare & Wellness',
  {primaryColor:'#176B70',accentColor:'#58AAA1',pageBackground:'#F0F7F7',cardBackground:'#FFFFFF',textColor:'#2D4548',mutedColor:'#70878A',cardRadius:14,headingFontSize:27,bodyFontSize:15,bodyLineHeight:1.8},[
   b('brand-header','logo',{align:'left',width:150,padding:24,backgroundColor:'#FFFFFF',color:'#176B70'}),
   b('hero','hero',{eyebrow:'A CLEAR UPDATE FOR YOU',text:'Your wellbeing comes first.',secondaryText:'Helpful information, clear next steps and support when you need it.',fontSize:27,align:'left',padding:28,backgroundColor:'#E4F2F0',color:'#176B70'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'View your information',align:'left',padding:12,backgroundColor:'#176B70',color:'#FFFFFF'}),
   b('footer','footer',{padding:24,backgroundColor:'#F0F7F7',color:'#70878A'}),
  ]),
 p('webinar-invitation','Webinar Invitation','Event invitation that puts the topic, event details and registration action front and centre.','Events',
  {primaryColor:'#4C3A91',accentColor:'#F1A65B',pageBackground:'#F4F2FA',cardBackground:'#FFFFFF',textColor:'#302B43',mutedColor:'#7B7691',cardRadius:14,headingFontSize:30,bodyFontSize:15,bodyLineHeight:1.75},[
   b('brand-header','logo',{align:'left',width:150,padding:22,backgroundColor:'#FFFFFF',color:'#4C3A91'}),
   b('hero','hero',{eyebrow:'YOU ARE INVITED · LIVE SESSION',text:'A smarter approach starts with one conversation.',secondaryText:'Join us for practical insights, real examples and an open Q&A with our team.',fontSize:29,align:'center',padding:32,backgroundColor:'#35266D',color:'#FFFFFF'}),
   b('event-details','text',{text:'LIVE WEBINAR  ·  45 MINUTES  ·  ONLINE',fontSize:12,color:'#4C3A91',align:'center',padding:16}),
   b('content','content',{padding:10}),b('primary-cta','button',{text:'Reserve your place',align:'center',padding:16,backgroundColor:'#E89A4B',color:'#2B2345'}),
   b('footer','footer',{align:'center',padding:24,backgroundColor:'#F4F2FA',color:'#7B7691'}),
  ]),
 p('ecommerce-promotion','Seasonal Promotion','Retail-ready campaign with a warm offer panel, confident headline and prominent shopping action.','E-commerce',
  {primaryColor:'#A33B32',accentColor:'#F0B35D',pageBackground:'#FBF4EF',cardBackground:'#FFFFFF',textColor:'#382F2C',mutedColor:'#8A7770',cardRadius:10,headingFontSize:31,bodyFontSize:15,bodyLineHeight:1.7},[
   b('brand-header','logo',{align:'center',width:155,padding:22,backgroundColor:'#FFFFFF',color:'#A33B32'}),
   b('hero','hero',{eyebrow:'A LITTLE SOMETHING FOR YOU',text:'Good things are worth celebrating.',secondaryText:'Explore a limited-time collection selected with you in mind.',fontSize:30,align:'center',padding:30,backgroundColor:'#F6E4D9',color:'#8F332D'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Shop the collection',align:'center',padding:16,backgroundColor:'#A33B32',color:'#FFFFFF'}),
   b('footer','footer',{align:'center',padding:22,backgroundColor:'#FBF4EF',color:'#8A7770'}),
  ]),
 p('event-announcement','Event Announcement','Dramatic event announcement with a dark feature panel, event context and clear RSVP action.','Events',
  {primaryColor:'#172E43',accentColor:'#D6A96A',pageBackground:'#F1F4F6',cardBackground:'#FFFFFF',textColor:'#2C3D4B',mutedColor:'#73808A',cardRadius:8,headingFontSize:30,bodyFontSize:15,bodyLineHeight:1.75},[
   b('brand-header','logo',{align:'left',width:155,padding:22,backgroundColor:'#FFFFFF',color:'#172E43'}),
   b('hero','hero',{eyebrow:'SAVE THE DATE',text:'An evening of ideas and connection.',secondaryText:'Bring your questions, meet the community and leave with fresh perspective.',fontSize:30,align:'left',padding:32,backgroundColor:'#172E43',color:'#FFFFFF'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'RSVP now',align:'left',padding:14,backgroundColor:'#D6A96A',color:'#172E43'}),
   b('footer','footer',{padding:22,backgroundColor:'#F1F4F6',color:'#73808A'}),
  ]),
 p('customer-reengagement','A Note to Reconnect','Warm re-engagement design to restart a conversation without feeling overly promotional.','Engagement',
  {primaryColor:'#68456E',accentColor:'#D48B79',pageBackground:'#F7F2F6',cardBackground:'#FFFFFF',textColor:'#403342',mutedColor:'#887D8A',cardRadius:16,headingFontSize:28,bodyFontSize:15,bodyLineHeight:1.8},[
   b('brand-header','logo',{align:'left',width:150,padding:24,backgroundColor:'#FFFFFF',color:'#68456E'}),
   b('hero','hero',{eyebrow:'IT HAS BEEN A WHILE',text:'Shall we pick up where we left off?',secondaryText:'We would love to hear what has changed and see how we can help today.',fontSize:28,align:'left',padding:28,backgroundColor:'#F0E4EF',color:'#68456E'}),
   b('content','content',{padding:12}),b('primary-cta','button',{text:'Continue the conversation',align:'left',padding:14,backgroundColor:'#68456E',color:'#FFFFFF'}),
   b('footer','footer',{padding:24,backgroundColor:'#F7F2F6',color:'#887D8A'}),
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
 const allowed=['color','background','background-color','font-family','font-size','font-weight','font-style','line-height','text-align','text-decoration','text-transform','letter-spacing','word-break','white-space',
  'padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left',
  'width','max-width','min-width','height','max-height','border','border-top','border-right','border-bottom','border-left','border-radius',
  'border-collapse','vertical-align','display','-webkit-text-size-adjust','-ms-text-size-adjust','mso-table-lspace','mso-table-rspace'];
 return style.split(';').map((part)=>{
  const i=part.indexOf(':');if(i<1)return '';
  const key=part.slice(0,i).trim().toLowerCase(),value=part.slice(i+1).trim();
  if(!allowed.includes(key)||!value||/url\s*\(|expression|javascript:|@import|position\s*:/i.test(value))return '';
  if(key==='display'&&!/^(inline|inline-block|block|none|table|table-row|table-cell)$/i.test(value))return '';
  return key+':'+value.slice(0,180);
 }).filter(Boolean).join(';');
}
function sanitizeEmailStylesheet(input:string):string {
 const css=String(input||'').slice(0,12000).replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import[^;]+;?/gi,'');
 function rules(source:string,depth=0):string {
  if(depth>3)return '';
  let output='',cursor=0,ruleCount=0;
  while(cursor<source.length&&ruleCount<120){
   const open=source.indexOf('{',cursor);if(open<0)break;
   const selector=source.slice(cursor,open).trim();
   let level=1,close=open+1;
   while(close<source.length&&level>0){if(source[close]==='{')level++;else if(source[close]==='}')level--;close++;}
   if(level!==0)break;
   const body=source.slice(open+1,close-1).trim();cursor=close;ruleCount++;
   if(!selector||selector.length>220||/url\s*\(|expression|javascript:|@import|@font-face|@keyframes/i.test(selector+body))continue;
   if(/^@media\b/i.test(selector)){
    if(!/^@media\s+(?:only\s+)?screen\s+and\s+\((?:max|min)-width\s*:\s*\d+(?:\.\d+)?(?:px|em|rem)\)$/i.test(selector))continue;
    const nested=rules(body,depth+1);if(nested)output+=selector+'{'+nested+'}';
    continue;
   }
   if(selector.startsWith('@')||!/^[a-zA-Z0-9_.*#:\[\]="'\-\s,>+~]+$/.test(selector))continue;
   const safe=safeStyle(body);if(safe)output+=selector+'{'+safe+'}';
  }
  return output;
 }
 return rules(css);
}
export function sanitizeCustomEmailHtml(input:unknown):string {
 let html=String(input??'').slice(0,60000).replace(/<!doctype[^>]*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 const styles:string[]=[];
 html=html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,(_full,css:string)=>{
  const safe=sanitizeEmailStylesheet(css);if(safe)styles.push('<style type="text/css">'+safe+'</style>');
  return '';
 });
 html=html
  .replace(/<(script|iframe|object|embed|form|input|button|video|audio|svg|math|link|meta|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  .replace(/<(script|iframe|object|embed|form|input|button|video|audio|svg|math|link|meta|base)\b[^>]*\/?>/gi,'');
 const tags=new Set(['table','caption','colgroup','col','tbody','thead','tfoot','tr','td','th','div','span','p','br','strong','b','em','i','u','h1','h2','h3','h4','a','img','hr','ul','ol','li','blockquote','center','small','sup','sub','pre','address','font']);
 const safeHtml=html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,(full,rawTag:string,rawAttrs:string)=>{
  const tag=rawTag.toLowerCase();if(!tags.has(tag))return '';if(/^<\//.test(full))return '</'+tag+'>';
  const attrs:string[]=[];const pattern=/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;let m:RegExpExecArray|null;
  while((m=pattern.exec(rawAttrs))!==null){
   const name=m[1].toLowerCase(),value=m[2].replace(/^["']|["']$/g,'');
   if(name==='style'){const safe=safeStyle(value);if(safe)attrs.push('style="'+escapeEmailHtml(safe)+'"');}
   else if(['class','id'].includes(name)&&/^[a-zA-Z0-9 _-]{0,160}$/.test(value))attrs.push(name+'="'+escapeEmailHtml(value)+'"');
   else if(['align','valign','width','height','cellpadding','cellspacing','border','colspan','rowspan','role','alt','title','bgcolor'].includes(name)&&/^[a-z0-9 #.,%_-]{0,160}$/i.test(value))attrs.push(name+'="'+escapeEmailHtml(value)+'"');
   else if(name==='href'&&tag==='a'){const safe=value==='{{websiteUrl}}'?'{{websiteUrl}}':isSafeEmailUrl(value,false);if(safe)attrs.push('href="'+escapeEmailHtml(safe)+'"');}
   else if(name==='src'&&tag==='img'){const safe=isSafeEmailUrl(value,true);if(safe)attrs.push('src="'+escapeEmailHtml(safe)+'"');}
  }
  if(tag==='a')attrs.push('target="_blank" rel="noopener noreferrer"');
  if(tag==='img')attrs.push('border="0"');
  return '<'+tag+(attrs.length?' '+attrs.join(' '):'')+(['br','hr','img','col'].includes(tag)?' /':'')+'>';
 });
 return styles.join('\n')+(styles.length?'\n':'')+safeHtml;
}
export interface EmailDesignHtmlValidation {
 valid:boolean;
 contentSlotCount:number;
 error?:string;
 warnings:string[];
}
export function validateEmailDesignHtml(input:unknown):EmailDesignHtmlValidation {
 const html=String(input??''),contentSlotCount=(html.match(/\{\{content\}\}/g)||[]).length,warnings:string[]=[];
 let error:string|undefined;
 if(!html.trim())error='Add your email HTML before saving.';
 else if(html.length>60000)error='Email HTML must be 60,000 characters or fewer.';
 else if(contentSlotCount!==1)error='Your HTML must contain exactly one {{content}} placeholder. Found '+contentSlotCount+'.';
 else {
  const slotIndex=html.indexOf('{{content}}');
  const lastOpen=html.lastIndexOf('<',slotIndex),lastClose=html.lastIndexOf('>',slotIndex);
  const styleOpen=html.toLowerCase().lastIndexOf('<style',slotIndex),styleClose=html.toLowerCase().lastIndexOf('</style',slotIndex);
  if(lastOpen>lastClose||styleOpen>styleClose)error='Place {{content}} in the email body as text, not inside an HTML tag, attribute or CSS block.';
  else {
   const sanitized=sanitizeCustomEmailHtml(html),sanitizedCount=(sanitized.match(/\{\{content\}\}/g)||[]).length;
   if(sanitizedCount!==1)error='The message placeholder must be inside a supported HTML element so it is preserved when the email is sent.';
  }
 }
 if(!/<table\b/i.test(html))warnings.push('A table-based layout is recommended for consistent rendering in email clients.');
 if(/<(script|iframe|form|video|audio|object|embed)\b/i.test(html))warnings.push('Unsupported active or embedded elements will be removed before sending.');
 if(/display\s*:\s*(?:flex|grid)|position\s*:/i.test(html))warnings.push('Some modern web CSS is not supported in email clients; use tables and inline styles instead.');
 return {valid:!error,contentSlotCount,...(error?{error}:{}),warnings};
}
export function normalizeEmailDesignTemplate(input:any,sourceOverride?:EmailDesignSource):EmailDesignTemplate {
 const raw=input&&typeof input==='object'?input:{},rt=raw.theme&&typeof raw.theme==='object'?raw.theme:{};
 const theme:EmailDesignTheme={
  pageBackground:safeHexColor(rt.pageBackground,'#F3F5F8'),cardBackground:safeHexColor(rt.cardBackground,'#FFFFFF'),
  primaryColor:safeHexColor(rt.primaryColor,'#183B66'),accentColor:safeHexColor(rt.accentColor,'#E68A35'),
  textColor:safeHexColor(rt.textColor,'#263445'),mutedColor:safeHexColor(rt.mutedColor,'#718096'),
  fontFamily:fonts.includes(rt.fontFamily)?rt.fontFamily:fonts[0],contentWidth:num(rt.contentWidth,600,480,680),cardRadius:num(rt.cardRadius,12,0,24),
  headingFontSize:num(rt.headingFontSize,28,18,42),bodyFontSize:num(rt.bodyFontSize,15,12,20),
  bodyLineHeight:Number.isFinite(Number(rt.bodyLineHeight))?Math.max(1.4,Math.min(2,Number(rt.bodyLineHeight))):1.72,
 };
 const types=new Set<EmailDesignBlockType>(['logo','hero','heading','text','content','image','button','divider','spacer','footer','social']);
 const blocks:EmailDesignBlock[]=(Array.isArray(raw.blocks)?raw.blocks:[]).slice(0,40).map((item:any,i:number)=>{
  const type=types.has(item?.type)?item.type as EmailDesignBlockType:'text';
  return {id:String(item?.id||'block-'+i).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||'block-'+i,type,
   text:String(item?.text??'').slice(0,5000),url:isSafeEmailUrl(item?.url,true),altText:String(item?.altText??'').slice(0,240),
   align:['left','center','right'].includes(item?.align)?item.align:'left',width:num(item?.width,560,80,680),
   fontSize:item?.fontSize===undefined||item?.fontSize===null?undefined:num(item.fontSize,type==='heading'||type==='hero'?theme.headingFontSize:theme.bodyFontSize,10,48),color:safeHexColor(item?.color,theme.textColor),
   backgroundColor:item?.backgroundColor?safeHexColor(item.backgroundColor,theme.cardBackground):'',padding:num(item?.padding,16,0,64),
   eyebrow:String(item?.eyebrow??'').slice(0,180),secondaryText:String(item?.secondaryText??'').slice(0,700),
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
function textHtml(text:string,lineHeight=1.72):string {
 return text.split(/\r?\n\r?\n/).map(p=>'<p style="margin:0 0 17px 0;line-height:'+lineHeight+'">'+p.split(/\r?\n/).map(escapeEmailHtml).join('<br/>')+'</p>').join('');
}
function renderBlock(item:EmailDesignBlock,t:EmailDesignTemplate,body:string,brand:Record<string,any>):string {
 if(item.enabled===false&&item.type!=='content')return '';
 const th=t.theme,align=item.align||'left',color=safeHexColor(item.color,th.textColor),pad=num(item.padding,16,0,64);
 const background=item.backgroundColor?safeHexColor(item.backgroundColor,th.cardBackground):'';
 const wrap=(content:string,style='')=>'<tr><td align="'+align+'"'+(background?' bgcolor="'+background+'"':'')+' style="padding:'+pad+'px 28px;'+(background?'background:'+background+';':'')+style+'">'+content+'</td></tr>';
 const label=String(item.text||'').replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team')).replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''));
 const secondary=String(item.secondaryText||'').replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team')).replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''));
 const eyebrowText=String(item.eyebrow||'').replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team')).replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''));
 switch(item.type){
  case 'logo':{
   const logo=isSafeEmailUrl(item.url,true)||isSafeEmailUrl(brand.logoUrl,true);
   const company=escapeEmailHtml(String(item.text||'').trim()||brand.companyName||'Our Team');
   return wrap(logo?'<img src="'+escapeEmailHtml(logo)+'" alt="'+escapeEmailHtml(item.altText||company)+'" width="'+num(item.width,180,80,320)+'" style="display:inline-block;max-width:100%;height:auto;border:0"/>':'<span style="font-size:22px;font-weight:700;letter-spacing:-.3px;color:'+color+'">'+company+'</span>','padding-top:20px;padding-bottom:20px;');
  }
  case 'hero':{
   const bg=safeHexColor(item.backgroundColor,th.primaryColor),heroColor=safeHexColor(item.color,'#FFFFFF');
   const eyebrow=eyebrowText?'<p style="margin:0 0 12px 0;color:'+heroColor+';font-family:'+th.fontFamily+';font-size:10px;line-height:1.4;font-weight:700;letter-spacing:1.7px">'+escapeEmailHtml(eyebrowText)+'</p>':'';
   const sub=secondary?'<p style="margin:14px 0 0 0;color:'+heroColor+';font-family:'+th.fontFamily+';font-size:'+Math.max(13,th.bodyFontSize)+'px;line-height:'+th.bodyLineHeight+'">'+escapeEmailHtml(secondary).replace(/\n/g,'<br/>')+'</p>':'';
   return '<tr><td bgcolor="'+bg+'" style="background:'+bg+';padding:'+pad+'px 30px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="'+align+'">'+eyebrow+'<h1 style="margin:0;color:'+heroColor+';font-family:'+th.fontFamily+';font-size:'+num(item.fontSize,th.headingFontSize,18,42)+'px;line-height:1.18;font-weight:700;letter-spacing:-.5px">'+escapeEmailHtml(label||'A message for you')+'</h1>'+sub+'</td></tr></table></td></tr>';
  }
  case 'heading':return wrap('<h1 style="margin:0;color:'+color+';font-family:'+th.fontFamily+';font-size:'+num(item.fontSize,th.headingFontSize,10,48)+'px;line-height:1.22;font-weight:700">'+escapeEmailHtml(label||'A message for you')+'</h1>');
  case 'text':return wrap('<div style="font-family:'+th.fontFamily+';font-size:'+num(item.fontSize,th.bodyFontSize,10,48)+'px;line-height:'+th.bodyLineHeight+';color:'+color+'">'+escapeEmailHtml(label).replace(/\n/g,'<br/>')+'</div>');
  case 'content':return '<tr><td align="left" style="padding:'+pad+'px 36px 24px 36px;font-family:'+th.fontFamily+';font-size:'+th.bodyFontSize+'px;color:'+th.textColor+';line-height:'+th.bodyLineHeight+'">'+body+'</td></tr>';
  case 'image':{const src=isSafeEmailUrl(item.url,true);if(!src)return '';const width=Math.min(th.contentWidth,num(item.width,th.contentWidth-56,80,680));return wrap('<img src="'+escapeEmailHtml(src)+'" alt="'+escapeEmailHtml(item.altText||'')+'" width="'+width+'" style="display:block;width:100%;max-width:'+width+'px;height:auto;border:0;border-radius:8px;margin:0 auto"/>','padding-top:10px;padding-bottom:10px;');}
  case 'button':{const href=isSafeEmailUrl(item.url,false)||isSafeEmailUrl(brand.websiteUrl,false),buttonBg=safeHexColor(item.backgroundColor,th.primaryColor),buttonColor=safeHexColor(item.color,'#FFFFFF');const content=href?'<a href="'+escapeEmailHtml(href)+'" target="_blank" style="display:inline-block;padding:14px 24px;color:'+buttonColor+';text-decoration:none;font-family:'+th.fontFamily+';font-size:14px;font-weight:700;letter-spacing:.1px">'+escapeEmailHtml(label||'Learn more')+'</a>':'<span style="display:inline-block;padding:14px 24px;color:'+buttonColor+';font-family:'+th.fontFamily+';font-size:14px;font-weight:700">'+escapeEmailHtml(label||'Learn more')+'</span>';return wrap('<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="'+align+'"><tr><td bgcolor="'+buttonBg+'" style="border-radius:7px;background:'+buttonBg+'">'+content+'</td></tr></table>');}
  case 'divider':return wrap('<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="1" style="height:1px;background:'+safeHexColor(item.color,'#E6EAF0')+';font-size:0;line-height:0">&nbsp;</td></tr></table>','padding-top:8px;padding-bottom:8px;');
  case 'spacer':return '<tr><td height="'+num(item.padding,24,4,80)+'" style="height:'+num(item.padding,24,4,80)+'px;font-size:0;line-height:0">&nbsp;</td></tr>';
  case 'footer':{
   const company=escapeEmailHtml(brand.companyName||'Our Team'),website=isSafeEmailUrl(brand.websiteUrl,false);
   const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(brand.salesEmail||brand.contactEmail||''))?String(brand.salesEmail||brand.contactEmail):'';
   const phone=String(brand.supportPhone||brand.contactPhone||'').slice(0,80),footerBg=safeHexColor(item.backgroundColor,th.pageBackground),footerColor=safeHexColor(item.color,th.mutedColor);
   return '<tr><td align="'+align+'" bgcolor="'+footerBg+'" style="padding:'+pad+'px 28px 28px 28px;background:'+footerBg+';font-family:'+th.fontFamily+';color:'+footerColor+';font-size:12px;line-height:1.7"><strong style="color:'+th.textColor+';font-size:13px">'+company+'</strong>'+(brand.tagline?'<br/>'+escapeEmailHtml(brand.tagline):'')+(email?'<br/><a href="mailto:'+escapeEmailHtml(email)+'" style="color:'+th.primaryColor+';text-decoration:none">'+escapeEmailHtml(email)+'</a>':'')+(phone?'<br/>'+escapeEmailHtml(phone):'')+(website?'<br/><a href="'+escapeEmailHtml(website)+'" style="color:'+th.primaryColor+';text-decoration:none">'+escapeEmailHtml(website.replace(/^https?:\/\//,'').replace(/\/$/,''))+'</a>':'')+'<br/><span style="font-size:10px;color:'+footerColor+'">You are receiving this message because you have an existing conversation with '+company+'.</span></td></tr>';
  }
  case 'social':{const links=(item.links||[]).filter(x=>x.label&&isSafeEmailUrl(x.url,false));return links.length?wrap(links.map(x=>'<a href="'+escapeEmailHtml(x.url)+'" style="display:inline-block;margin:0 8px;color:'+th.primaryColor+';font-size:12px;text-decoration:underline">'+escapeEmailHtml(x.label)+'</a>').join('')):'';}
  default:return '';
 }
}
export function renderEmailDesignHtml(input:EmailDesignTemplate,messageText:string,brandInput:Record<string,any>={},baseUrl=''):string {
 const t=normalizeEmailDesignTemplate(input),brand={...brandInput,...(t.brandProfile||{})},body=textHtml(String(messageText||''),t.theme.bodyLineHeight);
 if(t.customHtml){
  const custom=sanitizeCustomEmailHtml(t.customHtml).replace(/\{\{content\}\}/g,body)
   .replace(/\{\{companyName\}\}/g,escapeEmailHtml(brand.companyName||'Our Team'))
   .replace(/\{\{tagline\}\}/g,escapeEmailHtml(brand.tagline||''))
   .replace(/\{\{websiteUrl\}\}/g,escapeEmailHtml(isSafeEmailUrl(brand.websiteUrl,false)));
  const styles=(custom.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)||[]).join(''),fragment=custom.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  return '<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'+styles+'</head><body style="margin:0;padding:0;background:'+t.theme.pageBackground+'">'+fragment+'</body></html>';
 }
 const blocks=t.blocks.map(x=>renderBlock(x,t,body,brand)).join(''),base=isSafeEmailUrl(baseUrl,false);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="x-apple-disable-message-reformatting"/><title>'+escapeEmailHtml(t.name)+'</title></head><body style="margin:0;padding:0;background:'+t.theme.pageBackground+';-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="'+t.theme.pageBackground+'" style="width:100%;background:'+t.theme.pageBackground+'"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="'+t.theme.contentWidth+'" cellspacing="0" cellpadding="0" border="0" bgcolor="'+t.theme.cardBackground+'" style="width:100%;max-width:'+t.theme.contentWidth+'px;background:'+t.theme.cardBackground+';border-radius:'+t.theme.cardRadius+'px;border-collapse:separate;overflow:hidden"><tr><td style="font-family:'+t.theme.fontFamily+';color:'+t.theme.textColor+'"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'+blocks+'</table></td></tr></table><table role="presentation" width="'+t.theme.contentWidth+'" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:'+t.theme.contentWidth+'px"><tr><td align="center" style="padding:12px 10px;color:'+t.theme.mutedColor+';font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5">'+(base?'<a href="'+escapeEmailHtml(base)+'" style="color:'+t.theme.mutedColor+';text-decoration:none">'+escapeEmailHtml(base.replace(/^https?:\/\//,'').replace(/\/$/,''))+'</a>':'')+'</td></tr></table></td></tr></table></body></html>';
}
export function createEmailDesignHtmlSource(input:EmailDesignTemplate,brand:Record<string,any>={}):string {
 const template={...input,customHtml:undefined};
 const rendered=renderEmailDesignHtml(template,'__AMAAVIGO_EMAIL_MESSAGE_SLOT__',brand);
 const placeholder=new RegExp('<p style="margin:0 0 17px 0;line-height:[0-9.]+">__AMAAVIGO_EMAIL_MESSAGE_SLOT__<\\/p>');
 return rendered.replace(placeholder,'{{content}}');
}
export function createBlankEmailDesignTemplate():EmailDesignTemplate {
 return {id:'',name:'My custom email design',description:'A custom email design created from scratch.',category:'Custom',source:'CUSTOM',version:1,theme:{...DEFAULT_EMAIL_DESIGN_THEME},
  blocks:[b(createEmailDesignBlockId('logo'),'logo',{align:'left',width:160,padding:26}),b(createEmailDesignBlockId('heading'),'heading',{text:'A message for you',fontSize:24,padding:20}),b(createEmailDesignBlockId('content'),'content',{padding:16}),b(createEmailDesignBlockId('footer'),'footer',{padding:24})]};
}
