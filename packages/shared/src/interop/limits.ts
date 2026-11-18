export const INTEROP_LIMITS = {
  MAX_TEXT_LENGTH: 5 * 1024 * 1024,
  MAX_INFLATED_BYTES: 16 * 1024 * 1024,
  MAX_NODES: 5000,
  MAX_EDGES: 10000,
} as const;

export function assertInteropTextSize(text: string, label: string): void {
  if (text.length > INTEROP_LIMITS.MAX_TEXT_LENGTH) {
    throw new Error(`${label} 输入文本超过安全上限（最大 ${INTEROP_LIMITS.MAX_TEXT_LENGTH} 字符）`);
  }
}

export function assertInteropCounts(nodeCount: number, edgeCount: number, label: string): void {
  if (nodeCount > INTEROP_LIMITS.MAX_NODES) {
    throw new Error(`${label} 节点数量超过安全上限（最大 ${INTEROP_LIMITS.MAX_NODES}）`);
  }
  if (edgeCount > INTEROP_LIMITS.MAX_EDGES) {
    throw new Error(`${label} 连线数量超过安全上限（最大 ${INTEROP_LIMITS.MAX_EDGES}）`);
  }
}
