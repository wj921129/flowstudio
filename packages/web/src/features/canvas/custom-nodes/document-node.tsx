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
        {/* 波浪基线取 94、最低点触达 99，使底部连接桩正好落在纸面上沿而非悬在波形之下 */}
        <path
          d="M 1,1 L 99,1 L 99,94 Q 75,84 50,94 Q 25,104 1,94 Z"
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
