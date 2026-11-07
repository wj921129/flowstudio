/**
 * @fileoverview 自定义连线组件注册表
 * @description 统一导出 edgeTypes 映射表，将 orthogonal 注册为标准 90° 正交折线
 */

import type { EdgeTypes } from '@xyflow/react';
import { OrthogonalEdge } from './orthogonal-edge';

export const edgeTypes: EdgeTypes = {
  orthogonal: OrthogonalEdge,
  smoothstep: OrthogonalEdge,
};

export { OrthogonalEdge };
