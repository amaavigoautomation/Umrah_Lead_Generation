import React from 'react';
import { Lock, ShieldAlert, ArrowLeft, BookOpen, Sparkles } from 'lucide-react';
import { AppUser, ActiveTab } from '../types';

interface LockedModuleViewProps {
  currentUser: AppUser;
  attemptedTab: ActiveTab;
  onNavigateToAllowed: (tab: ActiveTab) => void;
}

export const LockedModuleView: React.FC<LockedModuleViewProps> = ({
  currentUser,
  attemptedTab,
  onNavigateToAllowed,
}) => {
  const firstAllowedTab = (currentUser.allowedModules[0] as ActiveTab) || 'knowledge';

  return (
    <div className="max-w-3xl mx-auto p-6 my-12 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xl space-y-6">
        <div className="inline-flex p-4 bg-orange-50 border border-orange-200 rounded-2xl text-orange-500">
          <Lock className="w-10 h-10" />
        </div>

        <div className="space-y-2 max-w-md mx-auto">
          <h2 className="text-xl font-bold text-slate-900">Module Access Restricted</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your account (<span className="text-slate-900 font-semibold">{currentUser.name}</span>) has been assigned role <strong className="text-orange-600 font-mono">{currentUser.role}</strong> and does not have permission to access the <span className="text-orange-600 font-semibold">{attemptedTab.toUpperCase()}</span> module.
          </p>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 max-w-lg mx-auto text-left text-xs space-y-2">
          <div className="flex items-center space-x-2 text-slate-800 font-semibold">
            <ShieldAlert className="w-4 h-4 text-orange-500" />
            <span>Assigned Module Permissions in DB:</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {currentUser.allowedModules.map((mod) => (
              <span
                key={mod}
                className="px-2.5 py-1 rounded-lg bg-white text-slate-800 border border-slate-200 text-[11px] font-medium flex items-center space-x-1 shadow-xs"
              >
                <span>✓ {mod}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 pt-1">
            To grant access to additional modules, update your user document in Firestore database collection <code className="text-slate-700 font-mono">app_users/{currentUser.userId}</code>.
          </p>
        </div>

        <div className="flex items-center justify-center space-x-3 pt-2">
          <button
            onClick={() => onNavigateToAllowed(firstAllowedTab)}
            className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition flex items-center space-x-2 shadow-md"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Allowed Module ({firstAllowedTab})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
