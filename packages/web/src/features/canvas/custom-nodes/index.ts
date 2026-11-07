/**
 * @fileoverview 自定义图元组件注册表
 * @description 统一导出 9 种基础图元组件映射表 nodeTypes
 */

import type { NodeTypes } from '@xyflow/react';
import { StartEndNode } from './start-end-node';
import { ProcessNode } from './process-node';
import { DecisionNode } from './decision-node';
import { IONode } from './io-node';
import { DocumentNode } from './document-node';
import { SubprocessNode } from './subprocess-node';
import { DatabaseNode } from './database-node';
import { CommentNode } from './comment-node';
import { GroupNode } from './group-node';

export const nodeTypes: NodeTypes = {
  'start-end': StartEndNode,
  process: ProcessNode,
  decision: DecisionNode,
  io: IONode,
  document: DocumentNode,
  subprocess: SubprocessNode,
  database: DatabaseNode,
  comment: CommentNode,
  group: GroupNode,
};

export {
  StartEndNode,
  ProcessNode,
  DecisionNode,
  IONode,
  DocumentNode,
  SubprocessNode,
  DatabaseNode,
  CommentNode,
  GroupNode,
};
