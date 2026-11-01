import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Mail, MessageCircle } from 'lucide-react';
import { EmailDesignStudio } from './EmailDesignStudio';
import { WhatsAppTemplatesPanel } from './WhatsAppTemplatesPanel';

export type TemplateStudioSection = 'conversation' | 'campaign' | 'whatsapp';

type Props = {
  tenantId: string;
  canManageWhatsAppTemplates?: boolean;
  initialView?: TemplateStudioSection;
  initialTemplateId?: string;
};

const SECTIONS: Array<{ id: TemplateStudioSection; label: string; description: string; icon: React.ReactNode }> = [
  { id: 'conversation', label: 'Conversation & AI', description: 'Branded designs for inbox emails and AI replies.', icon: <Mail className="h-4 w-4" /> },
  { id: 'campaign', label: 'Campaign Emails', description: 'Complete personalized emails for outbound campaigns.', icon: <LayoutTemplate className="h-4 w-4" /> },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Utility and marketing templates submitted to Meta.', icon: <MessageCircle className="h-4 w-4" /> },
];

export const TemplateStudio: React.FC<Props> = ({
  tenantId,
  canManageWhatsAppTemplates = false,
  initialView = 'conversation',
  initialTemplateId,
}) => {
  const [section, setSection] = useState<TemplateStudioSection>(initialView);

  useEffect(() => {
    setSection(initialView);
  }, [initialView]);

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
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3" role="tablist" aria-label="Template channels">
          {SECTIONS.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(item.id)}
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

      {section === 'conversation' && <EmailDesignStudio tenantId={tenantId} purpose="conversation" />}
      {section === 'campaign' && <EmailDesignStudio tenantId={tenantId} purpose="campaign" initialTemplateId={initialTemplateId} />}
      {section === 'whatsapp' && <WhatsAppTemplatesPanel canEdit={canManageWhatsAppTemplates} />}
    </div>
  );
};
