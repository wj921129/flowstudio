/**
 * @fileoverview 文档节点组件 (DocumentNode)
 * @description 底部波浪矩形几何外观，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const DocumentNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const fillColor = props.data.style?.fillColor ? String(props.data.style.fillColor) : 'var(--fs-node-bg)';
  const strokeColor = props.data.style?.borderColor ? String(props.data.style.borderColor) : 'var(--fs-node-border)';
  const strokeWidth = props.data.style?.borderWidth ?? 1.5;
  const strokeDasharray = props.data.style?.borderStyle === 'dashed' ? '4 4' : undefined;
  return (
    <BaseNodeWrapper {...props} className="!bg-transparent !border-transparent">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* 底部波浪：中心 (x=50) 处对齐 y=98，与底部连接桩及其他图元底边保持一致停靠间距 */}
        <path
          d="M 1,1 L 99,1 L 99,92 Q 75,84 50,98 Q 25,106 1,92 Z"
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
