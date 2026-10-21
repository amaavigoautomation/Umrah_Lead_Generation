import React from 'react';
import { Lock } from 'lucide-react';

export const UpgradeRequiredView: React.FC<{ featureLabel: string; planName?: string; isAdmin: boolean; onBack: () => void }> = ({
  featureLabel,
  planName,
  isAdmin,
  onBack,
}) => (
  <div className="max-w-xl mx-auto p-6 my-12 font-sans">
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm space-y-4">
      <div className="inline-flex p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-500">
        <Lock className="w-8 h-8" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">{featureLabel} isn't included in your plan</h2>
      <p className="text-sm text-slate-600">
        {planName ? `Your workspace is on the ${planName} plan. ` : ''}
        {isAdmin ? 'Upgrade your plan to unlock this feature.' : 'Ask your workspace admin to upgrade the plan to unlock this feature.'}
      </p>
      <button onClick={onBack} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        Back to inbox
      </button>
    </div>
  </div>
);
