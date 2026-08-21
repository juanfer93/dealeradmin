import React from 'react';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white" aria-label="dealerADMIN logo" role="img">
      <rect width="100" height="100" rx="22" fill="#0B817A" className="fill-[var(--brand)]" />
      <path d="M34 26V68" stroke="white" strokeWidth="8" strokeLinecap="round" />
      <path d="M34 47H66V26" stroke="white" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="66" cy="68" r="6.5" fill="white" />
    </svg>
  );
}
