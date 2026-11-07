/**
 * @fileoverview 画布辅助控制组件 (CanvasControls)
 * @description 位于画布左下角，提供缩放、自适应视口以及小地图 MiniMap 显隐控制
 */

import React, { useState } from 'react';
import { Panel, useReactFlow, MiniMap } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2, Map as MapIcon } from 'lucide-react';

export const CanvasControls: React.FC = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [showMiniMap, setShowMiniMap] = useState(false);

  return (
    <>
      {/* 小地图浮层（悬浮在左下方控制条上方） */}
      {showMiniMap && (
        <Panel position="bottom-left" className="!mb-14 !ml-3">
          <div className="p-1 rounded-xl bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-lg overflow-hidden">
            <MiniMap
              className="!relative !m-0 !w-44 !h-32 rounded-lg"
              nodeColor="var(--fs-node-border)"
              maskColor="var(--fs-canvas-dot)"
              style={{
                backgroundColor: 'var(--fs-canvas-bg)',
              }}
              zoomable
              pannable
            />
          </div>
        </Panel>
      )}

      {/* 底部快捷缩放控制栏 */}
      <Panel position="bottom-left" className="!mb-3 !ml-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-md select-none text-[var(--fs-text)]">
          <button
            type="button"
            title="放大视口"
            onClick={() => zoomIn({ duration: 200 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="缩小视口"
            onClick={() => zoomOut({ duration: 200 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
          <button
            type="button"
            title="自适应画布全部内容"
            onClick={() => fitView({ padding: 0.2, duration: 250 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
          <button
            type="button"
            title={showMiniMap ? '收起小地图' : '展开小地图'}
            onClick={() => setShowMiniMap((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors ${
              showMiniMap
                ? 'bg-[var(--fs-primary)] text-white'
                : 'hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            <MapIcon className="w-4 h-4" />
          </button>
        </div>
      </Panel>
    </>
  );
};
