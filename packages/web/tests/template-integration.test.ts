import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge, applyThemeToYDoc } from '../src/features/collaboration/yjs-doc-bridge';
import { THEME_PRESETS } from '../src/features/sidebar/styles/theme-presets';
import { TEMPLATES_REGISTRY, instantiateTemplate } from '../src/features/sidebar/templates';
import type { FlowNode } from '@flowstudio/shared';

describe('Y.Doc Template & Theme Integration', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });

    docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
    docB.on('update', (update: Uint8Array) => Y.applyUpdate(docA, update));
  });

  it('syncs themeId via metaMap across collaborative clients', () => {
    const cyberViolet = THEME_PRESETS.find((t) => t.id === 'cyber-violet')!;
    bridgeA.applyTheme(cyberViolet, true);

    expect(bridgeA.getThemeId()).toBe('cyber-violet');
    expect(bridgeB.getThemeId()).toBe('cyber-violet');
  });

  it('applies theme to nodes in a single transaction while preserving custom styles when configured', () => {
    const nodes: FlowNode[] = [
      {
        id: 'node-1',
        type: 'process',
        position: { x: 10, y: 10 },
        data: { label: 'Node 1', type: 'process' },
      },
      {
        id: 'node-2',
        type: 'process',
        position: { x: 100, y: 10 },
        data: {
          label: 'Custom Node',
          type: 'process',
          style: { fillColor: '#ff0000', isManualCustom: true },
        },
      },
      {
        id: 'node-comment',
        type: 'comment',
        position: { x: 200, y: 10 },
        data: { label: '便签', type: 'comment' },
      },
    ];

    bridgeA.setDiagram(nodes, []);

    const cyberViolet = THEME_PRESETS.find((t) => t.id === 'cyber-violet')!;
    bridgeA.applyTheme(cyberViolet, true);

    const bState = bridgeB.getState();
    const n1 = bState.nodes.find((n) => n.id === 'node-1')!;
    const n2 = bState.nodes.find((n) => n.id === 'node-2')!;
    const nComment = bState.nodes.find((n) => n.id === 'node-comment')!;

    // 普通节点应用了新主题
    expect((n1.data.style as any)?.borderColor).toBe(cyberViolet.tokens.nodeBorder);
    // 手动修改过的节点保留原样
    expect((n2.data.style as any)?.fillColor).toBe('#ff0000');
    // 便签黄色背景受保护，未被破坏
    expect((nComment.data.style as any)?.fillColor).not.toBe(cyberViolet.tokens.nodeBg);
  });

  it('instantiates and loads template into collaborative bridge', () => {
    const template = TEMPLATES_REGISTRY[0];
    const theme = THEME_PRESETS[0];
    const instance = instantiateTemplate(template, theme);

    bridgeA.setDiagram(instance.nodes, instance.edges);

    const bState = bridgeB.getState();
    expect(bState.nodes.length).toBe(template.nodes.length);
    expect(bState.edges.length).toBe(template.edges.length);
  });
});
