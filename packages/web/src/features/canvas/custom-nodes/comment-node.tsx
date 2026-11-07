/**
 * @fileoverview 注释便签节点组件 (CommentNode)
 * @description 便签折角外观与虚线边框，继承 BaseNodeWrapper
 */

import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';

export const CommentNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  return (
    <BaseNodeWrapper
      {...props}
      className="rounded-md border-2 border-dashed bg-[var(--fs-note-bg)] border-[var(--fs-note-border)] shadow-sm"
    >
      <div className="absolute top-0 right-0 w-3 h-3 bg-[var(--fs-note-border)] rounded-bl pointer-events-none" />
    </BaseNodeWrapper>
  );
};
