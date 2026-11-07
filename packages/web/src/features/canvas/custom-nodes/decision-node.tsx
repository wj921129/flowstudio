/**
 * @fileoverview 条件判断节点组件 (DecisionNode)
 * @description 经典菱形外观，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const DecisionNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const fillColor = props.data.style?.fillColor ? String(props.data.style.fillColor) : 'var(--fs-node-bg)';
  const strokeColor = props.data.style?.borderColor ? String(props.data.style.borderColor) : 'var(--fs-node-border)';
  return (
    <BaseNodeWrapper {...props} className="!bg-transparent !border-transparent">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        <polygon points="50,1 99,50 50,99 1,50" fill={fillColor} stroke={strokeColor} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </BaseNodeWrapper>
  );
};
