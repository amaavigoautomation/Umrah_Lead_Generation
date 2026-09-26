import React from 'react';

interface Umrah360LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const Umrah360Logo: React.FC<Umrah360LogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
}) => {
  const sizeMap = {
    sm: { icon: 'w-7 h-7', title: 'text-lg', subtitle: 'text-[8px]', line: 'h-[1.5px]' },
    md: { icon: 'w-10 h-10', title: 'text-2xl', subtitle: 'text-[10px]', line: 'h-[2px]' },
    lg: { icon: 'w-14 h-14', title: 'text-3xl', subtitle: 'text-[12px]', line: 'h-[2.5px]' },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`flex items-center space-x-3 select-none ${className}`}>
      {/* Globe Ribbon 3D Icon */}
      <div className={`relative flex-shrink-0 ${currentSize.icon} flex items-center justify-center`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="umrahGreenGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#15803d" />
              <stop offset="50%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#166534" />
            </linearGradient>
            <linearGradient id="umrahGreenGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
            <linearGradient id="umrahSilverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
            <linearGradient id="umrahGoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#d97706" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>

          {/* Background Outer Sphere Shadow */}
          <circle cx="50" cy="50" r="46" fill="#f8fafc" opacity="0.3" />

          {/* Silver Ribbon Back Arc */}
          <path
            d="M 12 40 C 20 20, 80 20, 88 40 C 80 60, 20 60, 12 40 Z"
            fill="url(#umrahSilverGrad)"
            opacity="0.85"
          />

          {/* Silver Ribbon Middle Sweep */}
          <path
            d="M 10 58 C 25 38, 75 38, 90 58 C 75 78, 25 78, 10 58 Z"
            fill="url(#umrahSilverGrad)"
            opacity="0.9"
          />

          {/* Green Ribbon Main Top Arc */}
          <path
            d="M 10 32 C 30 10, 70 10, 90 32 C 70 50, 30 50, 10 32 Z"
            fill="url(#umrahGreenGrad1)"
          />

          {/* Green Ribbon Center Swirl */}
          <path
            d="M 8 50 C 28 30, 72 30, 92 50 C 72 68, 28 68, 8 50 Z"
            fill="url(#umrahGreenGrad2)"
          />

          {/* Green Ribbon Bottom Arc */}
          <path
            d="M 12 68 C 32 50, 68 50, 88 68 C 68 86, 32 86, 12 68 Z"
            fill="url(#umrahGreenGrad1)"
          />
        </svg>
      </div>

      {/* Text Lockup */}
      <div className="flex flex-col justify-center">
        <div className="flex items-baseline leading-none">
          <span className={`font-extrabold ${currentSize.title} tracking-tight text-slate-900`}>
            Umrah
          </span>
          <span className={`font-light ${currentSize.title} tracking-tight text-amber-600 ml-0.5`}>
            360
          </span>
        </div>
        
        {showSubtitle && (
          <div className="flex items-center space-x-1 mt-0.5">
            <span className={`font-bold italic tracking-[0.18em] text-slate-600 ${currentSize.subtitle} uppercase whitespace-nowrap`}>
              TECH SOLUTIONS
            </span>
            <div className={`flex-1 bg-gradient-to-r from-amber-500 via-amber-400 to-transparent ${currentSize.line} rounded-full ml-1 min-w-[20px]`} />
          </div>
        )}
      </div>
    </div>
  );
};
