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

  it('源码审查：SaveStatusIndicator 具备三态切换、定时可见性与 Ctrl+S 键盘拦截', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/features/topbar/save-status-indicator.tsx'),
      'utf-8'
    );

    // 1. 指示器三态与 testid
    expect(code).toContain('data-testid="save-status-indicator"');
    expect(code).toContain('data-status={statusState}');
    expect(code).toContain('编辑中');
    expect(code).toContain('保存中...');
    expect(code).toContain('已自动保存');
    expect(code).toContain('上次保存于');

    // 2. 定时快照可见性（nextSnapshotAt 为空时隐蔽）
    expect(code).toContain('data-testid="snapshot-timer-indicator"');
    expect(code).toContain('saveStatus?.nextSnapshotAt && countdownStr');
    expect(code).toContain('下次快照:');

    // 3. 手动保存按钮与 testid
    expect(code).toContain('data-testid="manual-save-button"');
    expect(code).toContain('title="立即保存到数据库 (Ctrl+S / Cmd+S)"');
    expect(code).toContain('aria-label="手动保存"');

    // 4. Ctrl+S 拦截与 preventDefault
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
