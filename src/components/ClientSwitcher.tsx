import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { fetchOrgOverview, type OrgClient } from './OrgShell';
import { setActiveClientId, getActiveClientId } from '../services/authService';

/** Header dropdown for organization admins: jump between client brands, or back to the client list. */
const ClientSwitcher: React.FC = () => {
  const [clients, setClients] = useState<OrgClient[]>([]);
  const [open, setOpen] = useState(false);
  const active = getActiveClientId();

  useEffect(() => {
    fetchOrgOverview().then((d) => d && setClients(d.clients));
  }, []);

  const current = clients.find((c) => c.id === active);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold">
        <Building2 className="w-3.5 h-3.5 text-orange-600" />
        <span className="max-w-[140px] truncate">{current?.name || active}</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 text-xs">
          {clients.filter((c) => c.status !== 'suspended').map((c) => (
            <button key={c.id} onClick={() => (c.id === active ? setOpen(false) : setActiveClientId(c.id))}
              className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${c.id === active ? 'font-bold text-orange-700' : ''}`}>
              {c.name}
            </button>
          ))}
          <div className="border-t border-slate-100 mt-1 pt-1">
            <button onClick={() => setActiveClientId(null)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-600">All clients / manage</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientSwitcher;
