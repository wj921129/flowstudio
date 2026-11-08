/**
 * @fileoverview 数据库节点组件 (DatabaseNode)
 * @description 经典圆柱体外观，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const DatabaseNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const fillColor = props.data.style?.fillColor ? String(props.data.style.fillColor) : 'var(--fs-node-bg)';
  const strokeColor = props.data.style?.borderColor ? String(props.data.style.borderColor) : 'var(--fs-node-border)';
  const strokeWidth = props.data.style?.borderWidth ?? 1.5;
  const strokeDasharray = props.data.style?.borderStyle === 'dashed' ? '4 4' : undefined;
  return (
    <BaseNodeWrapper {...props} className="!bg-transparent !border-transparent">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        {/*
          上下弧线各占 12 单位，使视觉边界正好落在 viewBox 的 1~99：
          几何内缩会让底部连接桩与柱底之间出现可见间隙，连线箭头随之悬空
        */}
        <path
          d="M 1,13 L 1,87 A 49,12 0 0 0 99,87 L 99,13 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
        <ellipse
          cx="50"
          cy="13"
          rx="49"
          ry="12"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </BaseNodeWrapper>
  );
};
