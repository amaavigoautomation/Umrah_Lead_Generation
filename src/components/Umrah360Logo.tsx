import React from 'react';

interface Umrah360LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  systemName?: string;
  systemBadge?: string;
}

export const Umrah360Logo: React.FC<Umrah360LogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  systemName = 'Umrah360',
  systemBadge = 'AI Platform',
}) => {
  const sizeMap = {
    sm: {
      icon: 'w-7 h-7 text-sm',
      title: 'text-base',
      subtitle: 'text-[9px]',
      badge: 'text-[10px] px-1.5 py-0.5',
    },
    md: {
      icon: 'w-8 h-8 text-base',
      title: 'text-xl',
      subtitle: 'text-[10px]',
      badge: 'text-xs px-2 py-0.5',
    },
    lg: {
      icon: 'w-11 h-11 text-xl',
      title: 'text-2xl',
      subtitle: 'text-xs',
      badge: 'text-xs px-2.5 py-1',
    },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`flex items-center space-x-3 select-none ${className}`}>
      {/* Amaavigo Brand Mark Icon */}
      <div
        className={`relative flex-shrink-0 ${currentSize.icon} rounded-lg bg-white border border-orange-500/30 flex items-center justify-center shadow-xs text-orange-600 font-bold`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-orange-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="18" rx="4" />
          <polyline points="9 8 15 12 9 16" />
        </svg>
      </div>

      {/* Brand Text Lockup */}
      <div className="flex flex-col justify-center">
        <div className="flex items-center space-x-2">
          {/* amaavigo Wordmark */}
          <div className="flex items-baseline tracking-tight font-extrabold text-slate-900 text-lg leading-tight">
            <span>amaavig</span>
            <span className="text-orange-500">o</span>
          </div>

          {/* Separator / Product Tag */}
          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

          {systemName && (
            <span className="text-sm font-bold text-slate-800 hidden sm:inline-block">
              {systemName}
            </span>
          )}

          {systemBadge && (
            <span
              className={`rounded-full bg-orange-50 text-orange-700 border border-orange-200/80 font-semibold tracking-wide hidden sm:inline-flex items-center ${currentSize.badge}`}
            >
              {systemBadge}
            </span>
          )}
        </div>

        {showSubtitle && (
          <p className={`text-slate-400 font-medium ${currentSize.subtitle} leading-none mt-0.5`}>
            Where Brand takes Flight
          </p>
        )}
      </div>
    </div>
  );
};

export default Umrah360Logo;
