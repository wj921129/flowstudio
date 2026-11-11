import React, { useMemo } from 'react';
import { usePresentationStore } from './presentation-store';
import { useCollaboration } from '../collaboration/collaboration-provider';

export const WatermarkLayer: React.FC = () => {
  const isWatermarkEnabled = usePresentationStore((s) => s.isWatermarkEnabled);
  const watermarkCustomText = usePresentationStore((s) => s.watermarkCustomText);
  const collab = useCollaboration();

  const formattedTime = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const identityText = useMemo(() => {
    const name = collab?.currentUser?.nickname || '访客';
    const id = collab?.currentUser?.clientId ? ` (${collab.currentUser.clientId.slice(0, 6)})` : '';
    return `${name}${id}`;
  }, [collab?.currentUser]);

  if (!isWatermarkEnabled) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-40 pointer-events-none select-none overflow-hidden"
      style={{
        backgroundImage: `radial-gradient(transparent 1px, transparent 1px)`,
      }}
    >
      <svg className="w-full h-full opacity-60 dark:opacity-40" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="fs-security-watermark-pattern"
            width="320"
            height="220"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-25)"
          >
            <text
              x="20"
              y="60"
              fill="currentColor"
              className="text-zinc-600 dark:text-zinc-300 font-medium text-[13px] tracking-wide"
              fillOpacity="0.14"
            >
              {watermarkCustomText}
            </text>
            <text
              x="20"
              y="85"
              fill="currentColor"
              className="text-zinc-600 dark:text-zinc-300 text-[11px] font-mono tracking-wider"
              fillOpacity="0.11"
            >
              {identityText} · {formattedTime}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fs-security-watermark-pattern)" />
      </svg>
    </div>
  );
};
