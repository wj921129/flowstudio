import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createDocEpochGuard } from '../src/features/collaboration/doc-epoch-guard';

describe('docEpoch 客户端会话重建守卫', () => {
  it('首次 synced 记录初始 docEpoch（含 undefined 与预设值），不触发重建', () => {
    const doc1 = new Y.Doc();
    const onEpochChanged1 = vi.fn();
    const guard1 = createDocEpochGuard(doc1, onEpochChanged1);
    guard1.markSynced();
    expect(onEpochChanged1).not.toHaveBeenCalled();
    guard1.destroy();

    const doc2 = new Y.Doc();
    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('meta').set('docEpoch', 2);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(remoteDoc), 'hocuspocus-sync');
    const onEpochChanged2 = vi.fn();
    const guard2 = createDocEpochGuard(doc2, onEpochChanged2);
    guard2.markSynced();
    expect(onEpochChanged2).not.toHaveBeenCalled();
    guard2.destroy();
  });

  it('远端同步过来的 meta.docEpoch 相对于当前会话初始观测值变化时，触发一次会话重建回调', () => {
    const clientDoc = new Y.Doc();
    const serverV1 = new Y.Doc();
    serverV1.getMap('meta').set('title', '流程图');
    serverV1.getMap('meta').set('docEpoch', 1);
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverV1), 'remote');

    const onEpochChanged = vi.fn();
    const guard = createDocEpochGuard(clientDoc, onEpochChanged);
    guard.markSynced();
    expect(onEpochChanged).not.toHaveBeenCalled();

    // 模拟服务端离线清洗升级为 docEpoch=2 并同步给客户端（新血缘 clientID 严格大于旧版或基于同源推进）
    const serverV2 = new Y.Doc();
    serverV2.clientID = serverV1.clientID + 1;
    serverV2.getMap('meta').set('title', '流程图');
    serverV2.getMap('meta').set('docEpoch', 2);
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverV2), 'remote');

    expect(onEpochChanged).toHaveBeenCalledTimes(1);
    expect(onEpochChanged).toHaveBeenCalledWith(2, 1);

    // 后续再升至 3 也不会重复触发（单会话仅触发一次重建）
    const serverV3 = new Y.Doc();
    serverV3.clientID = serverV2.clientID + 1;
    serverV3.getMap('meta').set('docEpoch', 3);
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverV3), 'remote');
    expect(onEpochChanged).toHaveBeenCalledTimes(1);

    guard.destroy();
  });

  it('从无 docEpoch（undefined）变为远端 docEpoch=2 时同样触发重建，且不影响常规字段修改', () => {
    const clientDoc = new Y.Doc();
    const onEpochChanged = vi.fn();
    const guard = createDocEpochGuard(clientDoc, onEpochChanged);
    guard.markSynced();

    // 常规本地或远端修改 title 不触发
    clientDoc.transact(() => {
      clientDoc.getMap('meta').set('title', '新标题');
    }, 'local');
    expect(onEpochChanged).not.toHaveBeenCalled();

    // 远端同步 docEpoch=2 触发重建
    const cleaned = new Y.Doc();
    cleaned.getMap('meta').set('docEpoch', 2);
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(cleaned), 'remote');
    expect(onEpochChanged).toHaveBeenCalledTimes(1);
    expect(onEpochChanged).toHaveBeenCalledWith(2, undefined);

    guard.destroy();
  });

  it('destroy 后停止监听 docEpoch 变更', () => {
    const clientDoc = new Y.Doc();
    const onEpochChanged = vi.fn();
    const guard = createDocEpochGuard(clientDoc, onEpochChanged);
    guard.markSynced();
    guard.destroy();

    const cleaned = new Y.Doc();
    cleaned.getMap('meta').set('docEpoch', 2);
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(cleaned), 'remote');
    expect(onEpochChanged).not.toHaveBeenCalled();
  });
});
