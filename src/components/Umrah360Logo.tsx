import React, { useState } from 'react';

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
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: {
      logoImg: 'h-6',
      badge: 'text-[10px] px-1.5 py-0.5',
      subtitle: 'text-[9px]',
      icon: 'w-5 h-5',
    },
    md: {
      logoImg: 'h-8',
      badge: 'text-xs px-2 py-0.5',
      subtitle: 'text-[10px]',
      icon: 'w-7 h-7',
    },
    lg: {
      logoImg: 'h-11',
      badge: 'text-xs px-2.5 py-1',
      subtitle: 'text-xs',
      icon: 'w-9 h-9',
    },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`flex items-center space-x-3 select-none ${className}`}>
      {/* Official Amaavigo Logo */}
      <div className="flex items-center space-x-2">
        {!imgError ? (
          <img
            src="/amaavigo-logo.png"
            alt="Amaavigo"
            className={`${currentSize.logoImg} w-auto object-contain`}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex items-center space-x-2">
            <svg
              className={`${currentSize.icon} text-[#ef741a]`}
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="20" cy="20" r="18" fill="#fef6f3" stroke="#fed7aa" strokeWidth="2" />
              <path
                d="M12 26C14 20 18 14 26 13C24 18 20 22 14 24"
                stroke="#ef741a"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M16 27C18 23 22 19 28 17C26 21 23 24 18 26"
                stroke="#ea580c"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-display font-extrabold text-slate-900 tracking-tight text-lg">
              amaavigo
            </span>
          </div>
        )}

        {/* Separator / Product Tag */}
        <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

        {systemName && (
          <span className="text-sm font-bold text-slate-800 hidden sm:inline-block font-sans">
            {systemName}
          </span>
        )}

        {systemBadge && (
          <span
            className={`rounded-full bg-[#fef6f3] text-[#ef741a] border border-[#fed7aa] font-semibold tracking-wide hidden sm:inline-flex items-center ${currentSize.badge}`}
          >
            {systemBadge}
          </span>
        )}
      </div>

      {showSubtitle && (
        <span className="sr-only">Where Brand takes Flight</span>
      )}
    </div>
  );
};

export default Umrah360Logo;
