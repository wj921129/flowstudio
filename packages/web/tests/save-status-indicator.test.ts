import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { SaveStatusSummary } from '@flowstudio/shared';

describe('FS-033: 保存状态指示器、手动保存按钮与定时快照可见性', () => {
  it('apiClient 正确封装 getSaveStatus 与 forceSave 端点调用', async () => {
    const { apiClient } = await import('../src/lib/api-client.js');
    let calledUrl = '';
    let calledMethod = '';
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: any, options: any) => {
      calledUrl = String(url);
      calledMethod = options?.method || 'GET';
      if (calledUrl.includes('/save-status')) {
        return {
          ok: true,
          json: async (): Promise<SaveStatusSummary> => ({
            diagramId: 'diag-test',
            lastSavedAt: '2026-11-14T08:00:00.000Z',
            lastSnapshotAt: '2026-11-14T07:55:00.000Z',
            nextSnapshotAt: '2026-11-14T08:05:00.000Z',
            snapshotIntervalMs: 300000,
            serverTime: '2026-11-14T08:00:05.000Z',
          }),
        } as any;
      }
      if (calledUrl.includes('/save')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            flushed: true,
            status: {
              diagramId: 'diag-test',
              lastSavedAt: '2026-11-14T08:00:10.000Z',
              lastSnapshotAt: null,
              nextSnapshotAt: null,
              snapshotIntervalMs: null,
              serverTime: '2026-11-14T08:00:10.000Z',
            },
          }),
        } as any;
      }
      return { ok: false, statusText: 'Not Found' } as any;
    }) as any;

    try {
      const statusRes = await apiClient.getSaveStatus('diag-test');
      expect(calledUrl).toContain('/api/diagrams/diag-test/save-status');
      expect(calledMethod).toBe('GET');
      expect(statusRes.diagramId).toBe('diag-test');
      expect(statusRes.snapshotIntervalMs).toBe(300000);

      const saveRes = await apiClient.forceSave('diag-test');
      expect(calledUrl).toContain('/api/diagrams/diag-test/save');
      expect(calledMethod).toBe('POST');
      expect(saveRes.success).toBe(true);
      expect(saveRes.flushed).toBe(true);
      expect(saveRes.status.lastSavedAt).toBe('2026-11-14T08:00:10.000Z');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('computeCanvasSignature 仅响应元素数据与位移变更，忽略选中态与瞬态属性', async () => {
    const { computeCanvasSignature } = await import('../src/features/topbar/save-status-indicator.js');
    const baseNodes: any[] = [
      { id: 'n1', type: 'process', position: { x: 100, y: 200 }, data: { label: 'A' }, selected: false },
    ];
    const baseEdges: any[] = [
      { id: 'e1', source: 'n1', target: 'n2', selected: false },
    ];

    const sigBase = computeCanvasSignature(baseNodes, baseEdges);
    const sigSelected = computeCanvasSignature(
      [{ ...baseNodes[0], selected: true, dragging: true }],
      [{ ...baseEdges[0], selected: true }]
    );
    expect(sigSelected).toBe(sigBase);

    const sigMoved = computeCanvasSignature(
      [{ ...baseNodes[0], position: { x: 120, y: 200 } }],
      baseEdges
    );
    expect(sigMoved).not.toBe(sigBase);

    const sigEdgeChanged = computeCanvasSignature(baseNodes, [{ ...baseEdges[0], label: '通过' }]);
    expect(sigEdgeChanged).not.toBe(sigBase);
  });

  it('canTriggerSave 强制同一协作者两次保存间隔不低于 5 秒', async () => {
    const { canTriggerSave, MIN_SAVE_INTERVAL_MS } = await import(
      '../src/features/topbar/save-status-indicator.js'
    );
    expect(MIN_SAVE_INTERVAL_MS).toBe(5_000);
    expect(canTriggerSave(0, 1000)).toBe(true);
    expect(canTriggerSave(10_000, 14_999)).toBe(false);
    expect(canTriggerSave(10_000, 15_000)).toBe(true);
  });

  it('源码审查：SaveStatusIndicator 采用圆形外边框 3 分钟顺时针进度条与 5 秒冷却', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/features/topbar/save-status-indicator.tsx'),
      'utf-8'
    );

    expect(code).toContain('data-testid="snapshot-progress-ring"');
    expect(code).toContain('data-testid="save-status-indicator"');
    expect(code).toContain('SNAPSHOT_COUNTDOWN_MS = 3 * 60_000');
    expect(code).toContain('MIN_SAVE_INTERVAL_MS = 5_000');
    expect(code).toContain('transform="rotate(-90 18 18)"');
    expect(code).toContain("saveAndCreateSnapshot('编辑前自动快照', 'auto')");
    expect(code).toContain("saveAndCreateSnapshot('定时自动快照', 'timer')");
    expect(code).not.toContain('保存中...');
    expect(code).not.toContain('下次快照:');
    expect(code).toContain("(e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')");
    expect(code).toContain('e.preventDefault()');
    expect(code).toContain('handleManualSave()');
  });

  it('源码审查：TopBar 成功集成 SaveStatusIndicator', () => {
    const topbarCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/topbar/top-bar.tsx'),
      'utf-8'
    );
    expect(topbarCode).toContain("import { SaveStatusIndicator } from './save-status-indicator'");
    expect(topbarCode).toContain('<SaveStatusIndicator');
    expect(topbarCode).toContain('diagramId={diagramId}');
  });
});
