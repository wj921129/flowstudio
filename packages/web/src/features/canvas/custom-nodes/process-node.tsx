/**
 * @fileoverview 处理节点组件 (ProcessNode)
 * @description 标准圆角矩形，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const ProcessNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  return (
    <BaseNodeWrapper {...props} className="rounded-lg border border-[var(--fs-node-border)]" />
  );
};
