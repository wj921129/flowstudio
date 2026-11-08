import { describe, it, expect } from 'vitest';
import { sanitizeDiagramId } from '../src/features/collaboration/ai-batch-banner';

describe('sanitizeDiagramId - 防御性 diagramId 格式化', () => {
  it('正确保留标准合法 diagramId', () => {
    expect(sanitizeDiagramId('diag-mw733jm4-6jdh')).toBe('diag-mw733jm4-6jdh');
  });

  it('剥离 location.hash.slice(1) 产生的 /diagram/diag-xxx 前缀', () => {
    expect(sanitizeDiagramId('/diagram/diag-mw733jm4-6jdh')).toBe('diag-mw733jm4-6jdh');
  });

  it('剥离原始 hash 前缀 #/diagram/diag-xxx', () => {
    expect(sanitizeDiagramId('#/diagram/diag-mw733jm4-6jdh')).toBe('diag-mw733jm4-6jdh');
  });

  it('剥离双斜杠与 query 参数 //diagram/diag-123?zoom=1', () => {
    expect(sanitizeDiagramId('//diagram/diag-123?zoom=1')).toBe('diag-123');
  });

  it('非法路径或多级路径安全置空，杜绝目录遍历', () => {
    expect(sanitizeDiagramId('../../etc/passwd')).toBe('');
    expect(sanitizeDiagramId('nested/path/forbidden')).toBe('');
    expect(sanitizeDiagramId('')).toBe('');
    expect(sanitizeDiagramId(undefined)).toBe('');
  });
});
