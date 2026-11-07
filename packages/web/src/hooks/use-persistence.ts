/**
 * @fileoverview 本地持久化与数据水合 Hook
 * @description 负责组件挂载时从 localStorage 恢复图表数据，以及状态变更时的防抖自动保存
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AUTO_SAVE_DEBOUNCE_MS } from '@flowstudio/shared';
import { loadDiagram, saveDiagram } from '../lib/storage';
import { useFlowStore } from './use-flow-store';

export interface UsePersistenceReturn {
  /** 是否已完成首次本地数据水合 */
  isHydrated: boolean;
  /** 手动触发立即保存（跳过防抖） */
  saveNow: () => void;
}

/**
 * 流程图持久化管理 Hook
 * - 组件挂载时从 localStorage 读取数据并水合至 store
 * - 节点或连线数据发生变动时，使用 AUTO_SAVE_DEBOUNCE_MS 进行防抖自动落盘
 * - 页面卸载 (beforeunload) 时刷新暂存，避免丢失最新更改
 */
export interface UsePersistenceOptions {
  disabled?: boolean;
}

export function usePersistence(options?: UsePersistenceOptions): UsePersistenceReturn {
  const isDisabled = options?.disabled ?? false;
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const setDiagram = useFlowStore((s) => s.setDiagram);

  const [isHydrated, setIsHydrated] = useState(false);
  const isHydratedRef = useRef(false);
  const hasHydratedOnceRef = useRef(false);

  // 挂载时执行一次数据水合（若非禁用）
  useEffect(() => {
    if (isDisabled) {
      setIsHydrated(true);
      isHydratedRef.current = true;
      return;
    }
    if (hasHydratedOnceRef.current) {
      return;
    }
    hasHydratedOnceRef.current = true;

    try {
      const persisted = loadDiagram();
      if (persisted !== null) {
        setDiagram(persisted.nodes, persisted.edges);
      }
    } catch (error) {
      console.error('[usePersistence] 挂载水合失败:', error);
    } finally {
      setIsHydrated(true);
      isHydratedRef.current = true;
    }
  }, [setDiagram, isDisabled]);

  // 保持最新数据引用以供卸载或即时保存时使用
  const latestDataRef = useRef({ nodes, edges });
  latestDataRef.current = { nodes, edges };

  // 防抖自动保存逻辑
  useEffect(() => {
    if (isDisabled || !isHydratedRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      saveDiagram(latestDataRef.current.nodes, latestDataRef.current.edges);
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [nodes, edges, isDisabled]);

  // 页面离开时执行最后一次落盘保障
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isDisabled && isHydratedRef.current) {
        saveDiagram(latestDataRef.current.nodes, latestDataRef.current.edges);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDisabled]);

  // 立即保存方法
  const saveNow = useCallback(() => {
    if (!isDisabled && isHydratedRef.current) {
      saveDiagram(latestDataRef.current.nodes, latestDataRef.current.edges);
    }
  }, [isDisabled]);


  return {
    isHydrated,
    saveNow,
  };
}
