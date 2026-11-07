/**
 * @fileoverview 子流程节点组件 (SubprocessNode)
 * @description 双侧垂直边线矩形外观，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const SubprocessNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  return (
    <BaseNodeWrapper {...props} className="rounded border border-[var(--fs-node-border)]">
      <div className="absolute top-0 bottom-0 left-3 w-px bg-[var(--fs-node-border)] pointer-events-none" />
      <div className="absolute top-0 bottom-0 right-3 w-px bg-[var(--fs-node-border)] pointer-events-none" />
    </BaseNodeWrapper>
  );
};
