import React, { useState } from 'react';
import { useBrand } from '../context/BrandContext';

interface Umrah360LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  systemName?: string;
  systemBadge?: string;
  /** Render the workspace mark in white on the dark application rail. */
  lightOnDark?: boolean;
  /** Keep only compact logo artwork when used in the narrow icon rail. */
  compactMark?: boolean;
}

export const Umrah360Logo: React.FC<Umrah360LogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  systemName,
  systemBadge = 'AI Platform',
  lightOnDark = false,
  compactMark = false,
}) => {
  const [imgError, setImgError] = useState(false);
  const { brand } = useBrand();
  const name = systemName ?? brand.companyName;
  const useAmaavigoMark = brand.playbook === 'umrah360' && !brand.logoUrl;

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
      {/* Workspace logo (company's own logo, or text wordmark). The Amaavigo mark is kept for the Umrah360 workspace. */}
      <div className="flex items-center space-x-2">
        {!useAmaavigoMark ? (
          brand.logoUrl && !imgError ? (
            <img
              src={brand.logoUrl}
              alt={brand.companyName}
              className={`${currentSize.logoImg} w-auto max-w-[40px] object-contain ${lightOnDark ? 'brightness-0 invert' : ''}`}
              onError={() => setImgError(true)}
            />
          ) : (
            compactMark ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[12px] font-extrabold uppercase text-white">{(brand.companyName || 'W').slice(0,1)}</span>
            ) : (
              <span className={`font-display font-extrabold tracking-tight text-lg truncate max-w-[10rem] ${lightOnDark ? 'text-white' : 'text-slate-900'}`}>
                {brand.companyName || 'Workspace'}
              </span>
            )
          )
        ) : !imgError ? (
          <img
            src="/amaavigo-logo.png"
            alt="Amaavigo"
            className={`${currentSize.logoImg} w-auto max-w-[40px] object-contain ${lightOnDark ? 'brightness-0 invert' : ''}`}
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
              <circle cx="20" cy="20" r="18" fill={lightOnDark ? '#05051f' : '#fef6f3'} stroke={lightOnDark ? '#ffffff' : '#fed7aa'} strokeWidth="2" />
              <path
                d="M12 26C14 20 18 14 26 13C24 18 20 22 14 24"
                stroke={lightOnDark ? '#ffffff' : '#ef741a'}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M16 27C18 23 22 19 28 17C26 21 23 24 18 26"
                stroke={lightOnDark ? '#ffffff' : '#ea580c'}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            {!compactMark && <span className={`font-display font-extrabold tracking-tight text-lg ${lightOnDark ? 'text-white' : 'text-slate-900'}`}>amaavigo</span>}
          </div>
        )}

        {/* Separator / Product Tag */}
        {useAmaavigoMark && !compactMark && <div className={`h-4 w-px mx-1 hidden sm:block ${lightOnDark ? 'bg-white/30' : 'bg-slate-200'}`} />}

        {useAmaavigoMark && name && !compactMark && (
          <span className={`text-sm font-bold hidden sm:inline-block font-sans ${lightOnDark ? 'text-white' : 'text-slate-800'}`}>
            {name}
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
