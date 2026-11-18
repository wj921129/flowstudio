import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  ErrorBoundary,
  buildSafeEmergencyExportPayload,
  exportEmergencyDiagramJson,
} from '../src/components/error-boundary';
import { useFlowStore } from '../src/stores/flow-store';

function findElement(
  node: React.ReactNode,
  predicate: (el: React.ReactElement<any>) => boolean
): React.ReactElement<any> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement<any>;
  if (predicate(el)) return el;
  return findElement(el.props?.children, predicate);
}

describe('前端分级容错边界与异常保底导出', () => {
  const originalState = useFlowStore.getState();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    useFlowStore.setState(originalState, true);
  });

  it('正常态直接透传子节点且不渲染降级界面', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary title="画布异常">
        <div data-testid="healthy-child">正常内容</div>
      </ErrorBoundary>
    );
    expect(html).toContain('正常内容');
    expect(html).not.toContain('画布异常');
    expect(html).not.toContain('重试');
  });

  it('捕获渲染异常后显示中文降级提示与重试按钮，并在点击重试后恢复状态', () => {
    const onReset = vi.fn();
    const onError = vi.fn();
    const boundary = new ErrorBoundary({
      title: '画布渲染异常',
      description: '单节点渲染失败',
      onReset,
      onError,
      children: React.createElement('div', null, '恢复后的画布'),
    });

    const error = new Error('节点渲染崩溃');
    const nextState = ErrorBoundary.getDerivedStateFromError(error);
    expect(nextState.hasError).toBe(true);
    expect(nextState.error).toBe(error);

    (boundary as any).state = nextState;
    boundary.componentDidCatch(error, { componentStack: '\n  at BrokenNode' });
    expect(onError).toHaveBeenCalledTimes(1);

    const setStateSpy = vi.fn((updater: any) => {
      const patch = typeof updater === 'function' ? updater((boundary as any).state) : updater;
      (boundary as any).state = { ...(boundary as any).state, ...patch };
    });
    (boundary as any).setState = setStateSpy;

    const tree = boundary.render();
    const html = renderToStaticMarkup(tree as React.ReactElement);
    expect(html).toContain('画布渲染异常');
    expect(html).toContain('单节点渲染失败');
    expect(html).toContain('节点渲染崩溃');
    expect(html).toContain('重试');
    expect(html).not.toContain('紧急导出 JSON');

    const retryBtn = findElement(
      tree,
      (el) => el.type === 'button' && String(el.props?.['data-testid'] ?? '').includes('retry')
    );
    expect(retryBtn).not.toBeNull();
    retryBtn!.props.onClick();

    expect(setStateSpy).toHaveBeenCalledTimes(1);
    expect((boundary as any).state.hasError).toBe(false);
    expect((boundary as any).state.error).toBeNull();
    expect(onReset).toHaveBeenCalledTimes(1);

    const recoveredHtml = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(recoveredHtml).toContain('恢复后的画布');
  });

  it('提供紧急导出回调时渲染「紧急导出 JSON」按钮并可触发导出', () => {
    const onEmergencyExport = vi.fn();
    const boundary = new ErrorBoundary({
      title: '侧边栏渲染异常',
      onEmergencyExport,
      children: React.createElement('div', null, '正常侧边栏'),
    });
    (boundary as any).state = ErrorBoundary.getDerivedStateFromError(new Error('侧边栏崩溃'));

    const tree = boundary.render();
    const html = renderToStaticMarkup(tree as React.ReactElement);
    expect(html).toContain('紧急导出 JSON');

    const exportBtn = findElement(
      tree,
      (el) => el.type === 'button' && String(el.props?.['data-testid'] ?? '').includes('emergency-export')
    );
    expect(exportBtn).not.toBeNull();
    exportBtn!.props.onClick();
    expect(onEmergencyExport).toHaveBeenCalledTimes(1);
  });

  it('resetKey 变化时自动清除错误状态以恢复切图渲染', () => {
    const boundary = new ErrorBoundary({
      resetKey: 'diagram-a',
      children: React.createElement('div', null, '图内容'),
    });
    (boundary as any).state = { hasError: true, error: new Error('图 A 异常') };

    const setStateSpy = vi.fn((patch: any) => {
      (boundary as any).state = { ...(boundary as any).state, ...patch };
    });
    (boundary as any).setState = setStateSpy;
    (boundary as any).props = { ...boundary.props, resetKey: 'diagram-b' };

    boundary.componentDidUpdate({ resetKey: 'diagram-a', children: null });
    expect((boundary as any).state.hasError).toBe(false);
    expect((boundary as any).state.error).toBeNull();
  });

  it('buildSafeEmergencyExportPayload 从损坏或含循环引用的状态中抢救合法图元并剔除瞬态字段', () => {
    const circularData: Record<string, unknown> = { label: '核心节点', count: 42n };
    circularData.self = circularData;
    const throwingNode: any = { id: 'n-throw', type: 'process', position: { x: 0, y: 0 } };
    Object.defineProperty(throwingNode, 'data', {
      enumerable: true,
      get() {
        throw new Error('corrupt getter');
      },
    });

    const payload = buildSafeEmergencyExportPayload({
      diagramTitle: '核心/审批:流程?',
      nodes: [
        null,
        { bad: true },
        {
          id: 'n1',
          type: 'process',
          position: { x: 10, y: 20 },
          selected: true,
          dragging: true,
          resizing: true,
          data: circularData,
        },
        throwingNode,
      ],
      edges: [
        'invalid-edge',
        { id: 'e-bad', source: 'n1' },
        { id: 'e1', source: 'n1', target: 'n2', selected: true, data: { label: '流转' } },
      ],
    });

    expect(payload.title).toBe('核心/审批:流程?');
    expect(payload.emergency).toBe(true);
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect((payload.nodes[0] as any).selected).toBe(undefined);
    expect((payload.nodes[0] as any).dragging).toBe(undefined);
    expect((payload.nodes[0] as any).data.self).toBe('[Circular]');
    expect((payload.nodes[0] as any).data.count).toBe('42');
    expect((payload.edges[0] as any).selected).toBe(undefined);

    const parsed = JSON.parse(JSON.stringify(payload));
    expect(parsed.nodes[0].id).toBe('n1');
    expect(parsed.edges[0].id).toBe('e1');
  });

  it('exportEmergencyDiagramJson 从 store 读取数据触发安全下载，且 store 读取抛错时不二次崩溃', () => {
    useFlowStore.setState({
      diagramTitle: '订单流程',
      nodes: [
        {
          id: 'n1',
          type: 'start-end',
          position: { x: 0, y: 0 },
          data: { label: '开始', type: 'start-end' },
        } as any,
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' } as any,
      ],
    });

    const createdLinks: Array<{ href: string; download: string; clicked: boolean }> = [];
    const origDocument = (globalThis as any).document;
    const origUrl = globalThis.URL;

    (globalThis as any).document = {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      createElement: () => {
        const link = {
          href: '',
          download: '',
          click: () => {
            link.clicked = true;
          },
          clicked: false,
        };
        createdLinks.push(link);
        return link;
      },
    };
    (globalThis as any).URL = {
      createObjectURL: vi.fn(() => 'blob:emergency-test'),
      revokeObjectURL: vi.fn(),
    };

    try {
      const result = exportEmergencyDiagramJson();
      expect(result.success).toBe(true);
      expect(result.nodeCount).toBe(1);
      expect(result.edgeCount).toBe(1);
      expect(createdLinks).toHaveLength(1);
      expect(createdLinks[0].download).toBe('订单流程-emergency.json');
      expect(createdLinks[0].clicked).toBe(true);
      expect(JSON.parse(result.json).nodes[0].id).toBe('n1');

      vi.spyOn(useFlowStore, 'getState').mockImplementation(() => {
        throw new Error('store poisoned');
      });
      const fallbackResult = exportEmergencyDiagramJson();
      expect(fallbackResult.success).toBe(true);
      expect(fallbackResult.nodeCount).toBe(0);
    } finally {
      (globalThis as any).document = origDocument;
      (globalThis as any).URL = origUrl;
    }
  });

  it('app.tsx 挂载根级与编辑器分级 ErrorBoundary（隔离 FlowCanvas / SidebarDock / PropertyPanel 且保留 TopBar）', () => {
    const localAppPath = path.resolve(__dirname, '../src/app/app.tsx');
    const appPath = fs.existsSync(localAppPath)
      ? localAppPath
      : path.resolve(process.cwd(), 'packages/web/src/app/app.tsx');
    const appCode = fs.readFileSync(appPath, 'utf-8');

    expect(appCode).toContain("import { ErrorBoundary, exportEmergencyDiagramJson } from '../components/error-boundary'");

    const workspaceSection = appCode.slice(
      appCode.indexOf('const EditorWorkspace'),
      appCode.indexOf('export const App')
    );
    const appSection = appCode.slice(appCode.indexOf('export const App'));

    expect(appSection).toContain('<ErrorBoundary');
    expect(appSection).toContain('<Providers>');
    expect(appSection.indexOf('<ErrorBoundary') < appSection.indexOf('<Providers>')).toBe(true);

    expect(workspaceSection).toContain('<TopBar diagramId={diagramId} />');
    const workspaceBoundaries = workspaceSection.match(/<ErrorBoundary\b/g) ?? [];
    expect(workspaceBoundaries).toHaveLength(3);
    expect(workspaceSection).toContain('<SidebarDock');
    expect(workspaceSection).toContain('<FlowCanvas />');
    expect(workspaceSection).toContain('<PropertyPanel />');
    expect(workspaceSection).toContain('onEmergencyExport={exportEmergencyDiagramJson}');
    expect(workspaceSection).toContain('resetKey={diagramId}');
  });
});
