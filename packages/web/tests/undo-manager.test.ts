import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge, applyThemeToYDoc } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { THEME_PRESETS, DEFAULT_THEME_ID } from '../src/features/sidebar/styles/theme-presets';

describe('CollaborativeUndoManager', () => {
  let doc: Y.Doc;
  let bridgeLocal: YjsDiagramBridge;
  let bridgeRemote: YjsDiagramBridge;
  let undoManager: CollaborativeUndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    bridgeLocal = new YjsDiagramBridge(doc, { localClientId: 'user-local' });
    bridgeRemote = new YjsDiagramBridge(doc, { localClientId: 'user-remote' });
    undoManager = new CollaborativeUndoManager(doc, 'user-local', 0);
  });

  it('only undoes and redoes local user operations while preserving remote user edits', () => {
    // 1. 本地用户创建 node-a
    bridgeLocal.putNodes([
      { id: 'node-a', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A', type: 'process' } },
    ]);
    undoManager.stopCapturing();

    // 2. 远端用户创建 node-b 并修改 node-b
    bridgeRemote.putNodes([
      { id: 'node-b', type: 'decision', position: { x: 200, y: 0 }, data: { label: 'B', type: 'decision' } },
    ]);

    expect(bridgeLocal.toReactFlowState().nodes.length).toBe(2);
    expect(undoManager.canUndo()).toBe(true);

    // 3. 本地执行 undo：只撤掉 node-a，保留 node-b
    undoManager.undo();
    const afterUndo = bridgeLocal.toReactFlowState();
    expect(afterUndo.nodes.map((n) => n.id)).toEqual(['node-b']);

    // 4. 本地执行 redo：恢复 node-a
    undoManager.redo();
    const afterRedo = bridgeLocal.toReactFlowState();
    expect(afterRedo.nodes.map((n) => n.id).sort()).toEqual(['node-a', 'node-b']);
  });

  it('undoes and redoes meta.themeId together with node styles while ignoring system:init meta writes', () => {
    bridgeLocal.setTitle('服务端初始化标题', 'system:init');
    expect(undoManager.canUndo()).toBe(false);

    bridgeLocal.putNodes([
      { id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { label: '步骤', type: 'process' } },
    ]);
    undoManager.stopCapturing();

    const targetTheme = THEME_PRESETS.find((t) => t.id !== DEFAULT_THEME_ID)!;
    applyThemeToYDoc(doc, targetTheme, true, 'user-local');

    expect(bridgeLocal.getThemeId()).toBe(targetTheme.id);
    expect(bridgeLocal.toReactFlowState().nodes[0].data.style?.fillColor).toBe(targetTheme.tokens.nodeBg);

    undoManager.undo();
    expect(bridgeLocal.getThemeId()).toBe(DEFAULT_THEME_ID);
    expect(bridgeLocal.toReactFlowState().nodes[0].data.style?.fillColor).toBeUndefined();

    undoManager.redo();
    expect(bridgeLocal.getThemeId()).toBe(targetTheme.id);
    expect(bridgeLocal.toReactFlowState().nodes[0].data.style?.fillColor).toBe(targetTheme.tokens.nodeBg);
  });
});
