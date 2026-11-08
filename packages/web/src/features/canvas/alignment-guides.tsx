/**
 * @fileoverview 拖拽智能对齐参考线渲染层
 * @description 在视口坐标系内绘制对齐感应命中的横线/竖线，线宽按缩放反算保持 1 物理像素
 */

import React from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';
import { useFlowStore } from '../../stores/flow-store';
import type { AlignGuide } from './utils/alignment-snap';

function guideStyle(guide: AlignGuide, thickness: number): React.CSSProperties {
  if (guide.axis === 'vertical') {
    return {
      left: guide.position - thickness / 2,
      top: guide.start,
      width: thickness,
      height: Math.max(thickness, guide.end - guide.start),
    };
  }

  return {
    left: guide.start,
    top: guide.position - thickness / 2,
    width: Math.max(thickness, guide.end - guide.start),
    height: thickness,
  };
}

export const AlignmentGuides: React.FC = () => {
  const guides = useFlowStore((s) => s.alignmentGuides);
  const zoom = useStore((s) => s.transform[2]);

  if (guides.length === 0) return null;

  const thickness = 1 / (zoom || 1);

  return (
    <ViewportPortal>
      {guides.map((guide, index) => (
        <div
          key={`${guide.axis}-${guide.position}-${index}`}
          aria-hidden
          className="pointer-events-none absolute rounded-full bg-fs-align-guide"
          style={{ ...guideStyle(guide, thickness), zIndex: 1001 }}
        />
      ))}
    </ViewportPortal>
  );
};
