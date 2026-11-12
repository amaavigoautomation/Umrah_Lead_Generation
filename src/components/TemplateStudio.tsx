import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, LayoutTemplate, Mail, MessageCircle } from 'lucide-react';
import { EmailDesignStudio } from './EmailDesignStudio';
import { WhatsAppTemplatesPanel } from './WhatsAppTemplatesPanel';
import { CompanyAssetsPanel } from './CompanyAssetsPanel';

export type TemplateStudioSection = 'conversation' | 'campaign' | 'website-thankyou' | 'whatsapp' | 'assets';

type Props = {
  tenantId: string;
  canManageWhatsAppTemplates?: boolean;
  initialView?: TemplateStudioSection;
  initialTemplateId?: string;
};

const SECTIONS: Array<{ id: TemplateStudioSection; label: string; description: string; icon: React.ReactNode }> = [
  { id: 'conversation', label: 'Conversation & AI', description: 'Branded designs for inbox emails and AI replies.', icon: <Mail className="h-4 w-4" /> },
  { id: 'campaign', label: 'Campaign Emails', description: 'Complete personalized emails for outbound campaigns.', icon: <LayoutTemplate className="h-4 w-4" /> },
  { id: 'website-thankyou', label: 'Website Form Thank-you', description: 'Tenant-owned acknowledgement emails for website form submissions.', icon: <Mail className="h-4 w-4" /> },
  { id: 'whatsapp', label: 'WhatsApp Templates', description: 'Utility and marketing templates submitted to Meta.', icon: <MessageCircle className="h-4 w-4" /> },
  { id: 'assets', label: 'Company Assets', description: 'Reusable company logos, images, banners and video cards.', icon: <ImageIcon className="h-4 w-4" /> },
];

export const TemplateStudio: React.FC<Props> = ({
  tenantId,
  canManageWhatsAppTemplates = false,
  initialView = 'conversation',
  initialTemplateId,
}) => {
  const [section, setSection] = useState<TemplateStudioSection>(initialView);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | undefined>(initialTemplateId);
  const [visitedSections, setVisitedSections] = useState<Set<TemplateStudioSection>>(() => new Set([initialView]));

  useEffect(() => {
    setSection(initialView);
    setPendingTemplateId(initialTemplateId);
    setVisitedSections((current) => new Set([...current, initialView]));
  }, [initialView, initialTemplateId]);

  const changeSection = (next: TemplateStudioSection) => {
    if (section === 'campaign' && next !== 'campaign') setPendingTemplateId(undefined);
    setVisitedSections((current) => new Set([...current, next]));
    setSection(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Amaavigo Workspace</div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">Template Studio</h1>
            <p className="mt-1 text-xs text-slate-500">Create and manage branded communication templates from one workspace.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Template workspace sections">
          {SECTIONS.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeSection(item.id)}
                className={'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ' + (active ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50')}
              >
                <span className={'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' + (active ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600')}>{item.icon}</span>
                <span className="min-w-0">
                  <span className={'block text-xs font-bold ' + (active ? 'text-orange-900' : 'text-slate-800')}>{item.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {visitedSections.has('conversation') && <div className={section === 'conversation' ? 'block' : 'hidden'} aria-hidden={section !== 'conversation'}>
        <EmailDesignStudio tenantId={tenantId} purpose="conversation" initialTemplateId={pendingTemplateId} />
      </div>}
      {visitedSections.has('campaign') && <div className={section === 'campaign' ? 'block' : 'hidden'} aria-hidden={section !== 'campaign'}>
        <EmailDesignStudio tenantId={tenantId} purpose="campaign" initialTemplateId={pendingTemplateId} />
      </div>}
      {visitedSections.has('website-thankyou') && <div className={section === 'website-thankyou' ? 'block' : 'hidden'} aria-hidden={section !== 'website-thankyou'}>
        <EmailDesignStudio tenantId={tenantId} purpose="website-thankyou" initialTemplateId={pendingTemplateId} />
      </div>}
      {visitedSections.has('whatsapp') && <div className={section === 'whatsapp' ? 'block' : 'hidden'} aria-hidden={section !== 'whatsapp'}>
        <WhatsAppTemplatesPanel canEdit={canManageWhatsAppTemplates} />
      </div>}
      {visitedSections.has('assets') && <div className={section === 'assets' ? 'block' : 'hidden'} aria-hidden={section !== 'assets'}>
        <CompanyAssetsPanel />
      </div>}
    </div>
  );
};
