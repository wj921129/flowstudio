import React from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { useFlowStore } from '../stores/flow-store';
import { downloadFile } from '../lib/export-utils';

export interface SafeEmergencyExportPayload {
  title: string;
  version: string;
  emergency: true;
  exportedAt: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

export interface EmergencyExportResult {
  success: boolean;
  json: string;
  nodeCount: number;
  edgeCount: number;
}

const TRANSIENT_NODE_KEYS = new Set(['selected', 'dragging', 'resizing']);
const TRANSIENT_EDGE_KEYS = new Set(['selected']);

function safeCloneValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'bigint') return String(value);
  if (t === 'function' || t === 'symbol') return undefined;
  if (depth > 32) return '[MaxDepth]';

  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      const arr = obj.map((item) => {
        try {
          return safeCloneValue(item, seen, depth + 1);
        } catch {
          return null;
        }
      });
      seen.delete(obj);
      return arr;
    }

    const out: Record<string, unknown> = {};
    let keys: string[] = [];
    try {
      keys = Object.keys(obj);
    } catch {
      seen.delete(obj);
      return out;
    }
    for (const key of keys) {
      try {
        const cloned = safeCloneValue((obj as Record<string, unknown>)[key], seen, depth + 1);
        if (cloned !== undefined) out[key] = cloned;
      } catch {
        // 忽略损坏属性 getter，防止紧急导出二次崩溃
      }
    }
    seen.delete(obj);
    return out;
  }

  return undefined;
}

function sanitizeEntityRecord(
  item: unknown,
  transientKeys: Set<string>,
  requiredStringKeys: string[]
): Record<string, unknown> | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  for (const key of requiredStringKeys) {
    try {
      const val = (item as Record<string, unknown>)[key];
      if (typeof val !== 'string' || val.length === 0) return null;
    } catch {
      return null;
    }
  }

  const cloned = safeCloneValue(item);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
  const record = cloned as Record<string, unknown>;
  for (const k of transientKeys) {
    delete record[k];
  }
  return record;
}

function safeReadProp(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function buildSafeEmergencyExportPayload(rawState: unknown): SafeEmergencyExportPayload {
  const rawTitle = safeReadProp(rawState, 'diagramTitle');
  const title =
    typeof rawTitle === 'string' && rawTitle.trim().length > 0
      ? rawTitle.trim()
      : 'flowstudio-emergency-backup';

  const rawNodes = safeReadProp(rawState, 'nodes');
  const rawEdges = safeReadProp(rawState, 'edges');

  const safeNodes: Record<string, unknown>[] = [];
  if (Array.isArray(rawNodes)) {
    for (const item of rawNodes) {
      const cleaned = sanitizeEntityRecord(item, TRANSIENT_NODE_KEYS, ['id']);
      if (cleaned) safeNodes.push(cleaned);
    }
  }

  const safeEdges: Record<string, unknown>[] = [];
  if (Array.isArray(rawEdges)) {
    for (const item of rawEdges) {
      const cleaned = sanitizeEntityRecord(item, TRANSIENT_EDGE_KEYS, ['id', 'source', 'target']);
      if (cleaned) safeEdges.push(cleaned);
    }
  }

  return {
    title,
    version: '1.0',
    emergency: true,
    exportedAt: new Date().toISOString(),
    nodes: safeNodes,
    edges: safeEdges,
  };
}

export function exportEmergencyDiagramJson(): EmergencyExportResult {
  let rawState: unknown = null;
  try {
    rawState = useFlowStore.getState();
  } catch (err) {
    console.warn('[ErrorBoundary] 读取画布状态失败，将导出空保底备份:', err);
  }

  const payload = buildSafeEmergencyExportPayload(rawState);
  let json = '{}';
  try {
    json = JSON.stringify(payload, null, 2);
  } catch (err) {
    console.error('[ErrorBoundary] 紧急序列化失败:', err);
    json = JSON.stringify({
      title: payload.title,
      version: '1.0',
      emergency: true,
      exportedAt: payload.exportedAt,
      nodes: [],
      edges: [],
    }, null, 2);
  }

  const cleanTitle = payload.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'flowstudio-emergency-backup';
  if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
    try {
      downloadFile(`${cleanTitle}-emergency.json`, json, 'application/json');
    } catch (err) {
      console.error('[ErrorBoundary] 触发紧急下载失败:', err);
    }
  }

  return {
    success: true,
    json,
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
  };
}

export type ErrorBoundaryVariant = 'fullscreen' | 'canvas' | 'panel';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  variant?: ErrorBoundaryVariant;
  className?: string;
  resetKey?: string | number;
  onReset?: () => void;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onEmergencyExport?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const VARIANT_CONTAINER_CLASS: Record<ErrorBoundaryVariant, string> = {
  fullscreen: 'flex min-h-screen w-screen items-center justify-center bg-fs-bg p-6 text-fs-text',
  canvas: 'flex h-full w-full items-center justify-center bg-fs-bg/95 p-6 text-fs-text',
  panel: 'flex h-full w-72 shrink-0 items-center justify-center bg-fs-surface p-4 text-fs-text',
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error ?? '未知渲染异常')),
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] 捕获到组件渲染异常:', error, errorInfo);
    try {
      this.props.onError?.(error, errorInfo);
    } catch (callbackErr) {
      console.error('[ErrorBoundary] onError 回调执行异常:', callbackErr);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    try {
      this.props.onReset?.();
    } catch (err) {
      console.error('[ErrorBoundary] 重试回调执行异常:', err);
    }
  };

  handleEmergencyExport = (): void => {
    try {
      this.props.onEmergencyExport?.();
    } catch (err) {
      console.error('[ErrorBoundary] 紧急导出执行异常:', err);
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const {
      title = '模块渲染异常',
      description = '当前区域发生意外错误，您可以尝试恢复，或先紧急导出当前画布数据。',
      variant = 'panel',
      className = '',
      onEmergencyExport,
    } = this.props;

    const containerClass = `${VARIANT_CONTAINER_CLASS[variant]} ${className}`.trim();
    const message = this.state.error?.message || '未知渲染错误';

    return (
      <div role="alert" data-testid="error-boundary-fallback" className={containerClass}>
        <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-fs-border bg-fs-surface p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <AlertTriangle className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-fs-text">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-fs-text-muted">{description}</p>
            </div>
          </div>

          <div className="rounded-md border border-fs-border/70 bg-fs-bg/70 px-2.5 py-1.5 font-mono text-[11px] break-all text-fs-text-muted">
            {message}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              data-testid="error-boundary-retry"
              onClick={this.handleReset}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-fs-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </button>
            {onEmergencyExport && (
              <button
                type="button"
                data-testid="error-boundary-emergency-export"
                onClick={this.handleEmergencyExport}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-fs-border bg-fs-surface px-3 py-1.5 text-xs font-medium text-fs-text transition-colors hover:bg-fs-bg"
              >
                <Download className="h-3.5 w-3.5" />
                紧急导出 JSON
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
