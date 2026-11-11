import React from 'react';
import { useViewport } from '@xyflow/react';
import { useCollaboration } from './collaboration-provider.js';
import { worldToViewportPixel } from './user-identity.js';

export const CollaborativeCursors: React.FC = () => {
  const collab = useCollaboration();
  const viewport = useViewport();

  if (!collab || collab.remoteUsers.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {collab.remoteUsers.map((user) => {
        if (!user.cursor) return null;

        const pixelPos = worldToViewportPixel(user.cursor, viewport);

        return (
          <div
            key={user.clientId}
            className="absolute left-0 top-0 transition-transform duration-75 ease-out flex items-start gap-1 select-none"
            style={{
              transform: `translate3d(${pixelPos.x}px, ${pixelPos.y}px, 0)`,
            }}
          >
            {/* SVG 箭头光标 */}
            <svg
              className="w-4 h-4 drop-shadow-xs"
              viewBox="0 0 24 24"
              fill={user.color}
              stroke="#ffffff"
              strokeWidth="1.5"
            >
              <path d="M5.5 3.21a1 1 0 0 0-1.4 1.41l6.4 14.1a1 1 0 0 0 1.87-.15l2.25-6.75 6.75-2.25a1 1 0 0 0 .15-1.87L5.5 3.21z" />
            </svg>

            {/* 昵称气泡胶囊 */}
            <span
              className="text-[11px] font-semibold text-white px-1.5 py-0.5 rounded-full shadow-xs whitespace-nowrap"
              style={{ backgroundColor: user.color }}
            >
              {user.nickname}
            </span>
            {user.aiPlanning?.isPlanning && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-white px-2 py-0.5 rounded-full shadow-lg bg-gradient-to-r from-purple-600 to-indigo-600 animate-pulse whitespace-nowrap border border-white/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                AI 正在规划
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
