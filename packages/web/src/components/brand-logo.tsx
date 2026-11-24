import React from 'react';

export const BrandLogo: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="2.5" y="3.5" width="7" height="5.5" rx="1.8" fill="currentColor" opacity="0.95" />
    <rect x="14.5" y="3.5" width="7" height="5.5" rx="1.8" fill="currentColor" opacity="0.7" />
    <rect x="8.5" y="15" width="7" height="5.5" rx="1.8" fill="currentColor" />
    <path
      d="M6 9v2.2a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 11.2V9M12 12.7V15"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
