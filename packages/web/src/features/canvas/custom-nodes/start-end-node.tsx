/**
 * @fileoverview 开始/结束节点组件 (StartEndNode)
 * @description 胶囊圆形外观，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const StartEndNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  return (
    <BaseNodeWrapper {...props} className="rounded-full border border-[var(--fs-node-border)]" />
  );
};
