/**
 * @fileoverview 流程图属性面板右侧侧边栏组件 (PropertyPanel)
 * @description 单选节点或连线时展示对应的实时可编辑属性面板；未选中时呈现占位提示
 */

import React, { useCallback } from 'react';
import {
  SlidersHorizontal,
  X,
  Layers,
  Palette,
  Trash2,
  MousePointerClick,
  RotateCcw,
  CirclePlay,
  Square,
  Diamond,
  ArrowRightLeft,
  FileText,
  Workflow,
  Database,
  StickyNote,
  Spline,
} from 'lucide-react';
import {
  NODE_REGISTRY_RECORD,
  getDefaultNodeSize,
  type FlowNode,
  type FlowEdge,
} from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { getNodeDimensions } from '../canvas/utils/group-calculator';

/** 图标解析字典：将注册表中的图标字符串映射到对应的 Lucide 图标组件 */
const NODE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CirclePlay,
  Square,
  Diamond,
  ArrowRightLeft,
  FileText,
  Workflow,
  Database,
  StickyNote,
  Layers,
};

function resolveNodeIcon(iconName?: string): React.ComponentType<{ className?: string }> {
  if (!iconName) return Square;
  return NODE_ICON_MAP[iconName] ?? Square;
}

/** 颜色预设项定义 (严格统一使用 CSS 设计令牌) */
interface ColorPreset {
  label: string;
  value: string;
}

/** 节点填充底色预设选项 */
const FILL_COLOR_PRESETS: ColorPreset[] = [
  { label: '默认底色', value: 'var(--fs-node-bg)' },
  { label: '主色蓝', value: 'var(--fs-palette-1)' },
  { label: '自然绿', value: 'var(--fs-palette-2)' },
  { label: '琥珀黄', value: 'var(--fs-palette-3)' },
  { label: '警示红', value: 'var(--fs-palette-4)' },
  { label: '罗兰紫', value: 'var(--fs-palette-5)' },
  { label: '石板灰', value: 'var(--fs-palette-6)' },
  { label: '便签黄', value: 'var(--fs-note-bg)' },
  { label: '画布底色', value: 'var(--fs-canvas-bg)' },
  { label: '透明', value: 'transparent' },
];

/** 节点边框颜色预设选项 */
const BORDER_COLOR_PRESETS: ColorPreset[] = [
  { label: '默认边框', value: 'var(--fs-node-border)' },
  { label: '主色蓝', value: 'var(--fs-palette-1)' },
  { label: '自然绿', value: 'var(--fs-palette-2)' },
  { label: '琥珀黄', value: 'var(--fs-palette-3)' },
  { label: '警示红', value: 'var(--fs-palette-4)' },
  { label: '罗兰紫', value: 'var(--fs-palette-5)' },
  { label: '石板灰', value: 'var(--fs-palette-6)' },
  { label: '便签边框', value: 'var(--fs-note-border)' },
  { label: '强调蓝', value: 'var(--fs-accent)' },
];

/** 节点文字颜色预设选项 */
const FONT_COLOR_PRESETS: ColorPreset[] = [
  { label: '默认文本', value: 'var(--fs-node-text)' },
  { label: '次要文本', value: 'var(--fs-text-muted)' },
  { label: '主色蓝', value: 'var(--fs-palette-1)' },
  { label: '自然绿', value: 'var(--fs-palette-2)' },
  { label: '琥珀黄', value: 'var(--fs-palette-3)' },
  { label: '警示红', value: 'var(--fs-palette-4)' },
  { label: '罗兰紫', value: 'var(--fs-palette-5)' },
];

/** 连线描边颜色预设选项 */
const EDGE_COLOR_PRESETS: ColorPreset[] = [
  { label: '默认线条', value: 'var(--fs-edge-stroke)' },
  { label: '强调蓝', value: 'var(--fs-accent)' },
  { label: '主色蓝', value: 'var(--fs-palette-1)' },
  { label: '自然绿', value: 'var(--fs-palette-2)' },
  { label: '琥珀黄', value: 'var(--fs-palette-3)' },
  { label: '警示红', value: 'var(--fs-palette-4)' },
  { label: '罗兰紫', value: 'var(--fs-palette-5)' },
  { label: '石板灰', value: 'var(--fs-palette-6)' },
];

/** 调色选择器子组件属性 */
interface PaletteColorPickerProps {
  label: string;
  currentValue?: string;
  defaultValue: string;
  presets: ColorPreset[];
  onChange: (value: string | undefined) => void;
}

/**
 * 调色选择器子组件：色块色盘 + 令牌下拉选择 + 一键重置默认
 */
const PaletteColorPicker: React.FC<PaletteColorPickerProps> = ({
  label,
  currentValue,
  defaultValue,
  presets,
  onChange,
}) => {
  const activeValue = currentValue || defaultValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-[var(--fs-text-muted)]">{label}</label>
        {currentValue && currentValue !== defaultValue && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[10px] text-[var(--fs-text-muted)] hover:text-[var(--fs-primary)] flex items-center gap-0.5 transition-colors cursor-pointer"
            title="恢复默认颜色"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>默认</span>
          </button>
        )}
      </div>

      {/* 预设色块网格 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const isSelected = activeValue === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              title={preset.label}
              onClick={() => onChange(preset.value)}
              className={`w-5 h-5 rounded-md border transition-all cursor-pointer shrink-0 ${
                isSelected
                  ? 'border-[var(--fs-selection-ring)] ring-2 ring-[var(--fs-selection-ring)]/40 scale-105 shadow-xs'
                  : 'border-[var(--fs-border)] hover:scale-105 hover:border-[var(--fs-text-muted)]'
              }`}
              style={{
                backgroundColor: preset.value === 'transparent' ? 'transparent' : preset.value,
                backgroundImage:
                  preset.value === 'transparent'
                    ? 'linear-gradient(45deg, var(--fs-border) 25%, transparent 25%, transparent 75%, var(--fs-border) 75%), linear-gradient(45deg, var(--fs-border) 25%, transparent 25%, transparent 75%, var(--fs-border) 75%)'
                    : undefined,
                backgroundSize: preset.value === 'transparent' ? '6px 6px' : undefined,
                backgroundPosition: preset.value === 'transparent' ? '0 0, 3px 3px' : undefined,
              }}
            />
          );
        })}
      </div>

      {/* 令牌下拉备用选择 */}
      <select
        value={activeValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs px-2 py-1 rounded bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
      >
        {presets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export interface PropertyPanelProps {
  className?: string;
}

/**
 * 流程图右侧属性面板组件
 */
export const PropertyPanel: React.FC<PropertyPanelProps> = ({ className = '' }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const updateNodeDimensions = useFlowStore((s) => s.updateNodeDimensions);
  const updateEdgeData = useFlowStore((s) => s.updateEdgeData);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);

  // 模式判断：单选节点、单选连线或未选择
  const isSingleNodeSelected = selectedNodeIds.length === 1 && !selectedEdgeId;
  const isSingleEdgeSelected = !isSingleNodeSelected && Boolean(selectedEdgeId);
  const isMultiNodesSelected = selectedNodeIds.length > 1;

  const selectedNode: FlowNode | undefined = isSingleNodeSelected
    ? nodes.find((n) => n.id === selectedNodeIds[0])
    : undefined;

  const selectedEdge: FlowEdge | undefined = isSingleEdgeSelected
    ? edges.find((e) => e.id === selectedEdgeId)
    : undefined;

  /** 取消所有选中态 */
  const handleDeselect = useCallback(() => {
    setSelectedNodes([]);
    setSelectedEdge(null);
  }, [setSelectedNodes, setSelectedEdge]);

  return (
    <aside
      aria-label="图元属性面板"
      className={`h-full w-64 flex flex-col bg-fs-surface border-l border-fs-border shrink-0 select-none z-10 overflow-hidden ${className}`}
    >
      {/* 顶部标题栏 */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-fs-border shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <SlidersHorizontal className="w-4 h-4 text-fs-primary shrink-0" />
          <span className="text-xs font-semibold text-fs-text tracking-wide whitespace-nowrap">
            {isSingleNodeSelected && selectedNode
              ? NODE_REGISTRY_RECORD[selectedNode.type]?.label || '节点属性'
              : isSingleEdgeSelected
                ? '连线属性'
                : '属性面板'}
          </span>
          {(isSingleNodeSelected && selectedNode) || (isSingleEdgeSelected && selectedEdge) ? (
            <span
              title={isSingleNodeSelected ? selectedNode?.id : selectedEdge?.id}
              className="text-[10px] px-1.5 py-0.5 rounded bg-fs-bg border border-fs-border text-fs-text-muted font-mono truncate max-w-[80px]"
            >
              #{(isSingleNodeSelected ? selectedNode?.id : selectedEdge?.id)?.slice(-6)}
            </span>
          ) : null}
        </div>

        {(isSingleNodeSelected || isSingleEdgeSelected || isMultiNodesSelected) && (
          <button
            type="button"
            onClick={handleDeselect}
            aria-label="取消选中"
            title="取消选中"
            className="p-1.5 rounded-lg text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 面板内容主滚动区 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
        {/* 1. 节点属性模式 */}
        {isSingleNodeSelected && selectedNode && (
          <>
            {/* 基本属性区块 */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fs-text)]">
                {React.createElement(resolveNodeIcon(NODE_REGISTRY_RECORD[selectedNode.type]?.icon), {
                  className: 'w-3.5 h-3.5 text-[var(--fs-primary)]',
                })}
                <span>基本属性</span>
              </div>

              {/* 文本标签 */}
              <div>
                <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                  文本标签
                </label>
                <input
                  type="text"
                  value={selectedNode.data.label || ''}
                  placeholder="输入图元文本..."
                  onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] transition-colors"
                />
              </div>

              {/* 节点尺寸 */}
              {(() => {
                const dimensions = getNodeDimensions(selectedNode);
                const defaultSize = getDefaultNodeSize(selectedNode.type);
                const isCustomSize =
                  Math.round(dimensions.width) !== defaultSize.width ||
                  Math.round(dimensions.height) !== defaultSize.height;

                return (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-[var(--fs-text-muted)]">
                        尺寸大小 (W × H)
                      </label>
                      {isCustomSize && (
                        <button
                          type="button"
                          onClick={() =>
                            updateNodeDimensions(
                              selectedNode.id,
                              defaultSize.width,
                              defaultSize.height
                            )
                          }
                          className="text-[10px] text-[var(--fs-text-muted)] hover:text-[var(--fs-primary)] flex items-center gap-0.5 transition-colors cursor-pointer"
                          title="恢复预设尺寸"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>恢复默认</span>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-[var(--fs-text-muted)] block mb-0.5">
                          宽度 (W)
                        </span>
                        <input
                          type="number"
                          min={20}
                          max={2000}
                          step={15}
                          value={Math.round(dimensions.width)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val > 0) {
                              updateNodeDimensions(selectedNode.id, val, dimensions.height);
                            }
                          }}
                          className="w-full px-2 py-1 text-xs rounded bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--fs-text-muted)] block mb-0.5">
                          高度 (H)
                        </span>
                        <input
                          type="number"
                          min={20}
                          max={2000}
                          step={15}
                          value={Math.round(dimensions.height)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val > 0) {
                              updateNodeDimensions(selectedNode.id, dimensions.width, val);
                            }
                          }}
                          className="w-full px-2 py-1 text-xs rounded bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] font-mono"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 样式属性区块 */}
            <div className="space-y-3 pt-3 border-t border-[var(--fs-border)]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fs-text)]">
                <Palette className="w-3.5 h-3.5 text-[var(--fs-primary)]" />
                <span>外观样式</span>
              </div>

              {/* 填充颜色 */}
              <PaletteColorPicker
                label="填充颜色 (Fill Color)"
                currentValue={selectedNode.data.style?.fillColor}
                defaultValue="var(--fs-node-bg)"
                presets={FILL_COLOR_PRESETS}
                onChange={(val) => updateNodeData(selectedNode.id, { style: { fillColor: val } })}
              />

              {/* 边框颜色 */}
              <PaletteColorPicker
                label="边框颜色 (Border Color)"
                currentValue={selectedNode.data.style?.borderColor}
                defaultValue="var(--fs-node-border)"
                presets={BORDER_COLOR_PRESETS}
                onChange={(val) => updateNodeData(selectedNode.id, { style: { borderColor: val } })}
              />

              {/* 边框宽度与线型 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                    边框宽度
                  </label>
                  <select
                    value={selectedNode.data.style?.borderWidth ?? 1.5}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        style: { borderWidth: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
                  >
                    <option value={1}>1px (细)</option>
                    <option value={1.5}>1.5px (标准)</option>
                    <option value={2}>2px (中)</option>
                    <option value={3}>3px (粗)</option>
                    <option value={4}>4px (特粗)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                    边框线型
                  </label>
                  <select
                    value={selectedNode.data.style?.borderStyle ?? 'solid'}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        style: { borderStyle: e.target.value as 'solid' | 'dashed' },
                      })
                    }
                    className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
                  >
                    <option value="solid">实线 (solid)</option>
                    <option value="dashed">虚线 (dashed)</option>
                  </select>
                </div>
              </div>

              {/* 字体大小 */}
              <div>
                <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                  字体字号
                </label>
                <select
                  value={selectedNode.data.style?.fontSize ?? 14}
                  onChange={(e) =>
                    updateNodeData(selectedNode.id, {
                      style: { fontSize: parseInt(e.target.value, 10) },
                    })
                  }
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
                >
                  <option value={12}>12px (小号)</option>
                  <option value={14}>14px (标准)</option>
                  <option value={16}>16px (中号)</option>
                  <option value={18}>18px (大号)</option>
                  <option value={20}>20px (特大)</option>
                </select>
              </div>

              {/* 文字颜色 */}
              <PaletteColorPicker
                label="文字颜色 (Font Color)"
                currentValue={selectedNode.data.style?.fontColor}
                defaultValue="var(--fs-node-text)"
                presets={FONT_COLOR_PRESETS}
                onChange={(val) => updateNodeData(selectedNode.id, { style: { fontColor: val } })}
              />
            </div>

            {/* 3. 分组/容器框专属控制项 */}
            {selectedNode.type === 'group' && (
              <div className="space-y-3 pt-3 border-t border-[var(--fs-border)]">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fs-text)]">
                  <Layers className="w-3.5 h-3.5 text-[var(--fs-primary)]" />
                  <span>容器与组合属性</span>
                </div>

                {/* 形态切换 */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)]">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-[var(--fs-text)]">容器框形态</span>
                    <span className="text-[10px] text-[var(--fs-text-muted)]">
                      {selectedNode.data.isFrame ? '显式容器框 (含标题栏)' : '纯逻辑组合框'}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(selectedNode.data.isFrame)}
                    onClick={() =>
                      updateNodeData(selectedNode.id, { isFrame: !selectedNode.data.isFrame })
                    }
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                      selectedNode.data.isFrame
                        ? 'bg-[var(--fs-primary)] justify-end'
                        : 'bg-[var(--fs-border)] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-[var(--fs-surface)] shadow-xs transition-transform" />
                  </button>
                </div>

                {/* 折叠状态 */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)]">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-[var(--fs-text)]">折叠状态</span>
                    <span className="text-[10px] text-[var(--fs-text-muted)]">
                      {selectedNode.data.isCollapsed ? '已折叠' : '展开显示'}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(selectedNode.data.isCollapsed)}
                    onClick={() =>
                      updateNodeData(selectedNode.id, {
                        isCollapsed: !selectedNode.data.isCollapsed,
                      })
                    }
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                      selectedNode.data.isCollapsed
                        ? 'bg-[var(--fs-primary)] justify-end'
                        : 'bg-[var(--fs-border)] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-[var(--fs-surface)] shadow-xs transition-transform" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* 2. 连线属性模式 */}
        {isSingleEdgeSelected && selectedEdge && (
          <div className="space-y-4">
            {/* 连线基本信息 */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fs-text)]">
                <Spline className="w-3.5 h-3.5 text-[var(--fs-primary)]" />
                <span>连线设置</span>
              </div>

              {/* 连线文本 */}
              <div>
                <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                  连线文本 (Label)
                </label>
                <input
                  type="text"
                  value={selectedEdge.data?.label || selectedEdge.label || ''}
                  placeholder="输入连线标签..."
                  onChange={(e) => updateEdgeData(selectedEdge.id, { label: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] transition-colors"
                />
              </div>

              {/* 线条颜色 */}
              <PaletteColorPicker
                label="线条颜色 (Stroke Color)"
                currentValue={selectedEdge.data?.style?.strokeColor}
                defaultValue="var(--fs-edge-stroke)"
                presets={EDGE_COLOR_PRESETS}
                onChange={(val) => updateEdgeData(selectedEdge.id, { style: { strokeColor: val } })}
              />

              {/* 线条粗细 */}
              <div>
                <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                  线条粗细
                </label>
                <select
                  value={selectedEdge.data?.style?.strokeWidth ?? 1.5}
                  onChange={(e) =>
                    updateEdgeData(selectedEdge.id, {
                      style: { strokeWidth: parseFloat(e.target.value) },
                    })
                  }
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
                >
                  <option value={1}>1px (细线)</option>
                  <option value={1.5}>1.5px (标准)</option>
                  <option value={2}>2px (中等)</option>
                  <option value={3}>3px (粗线)</option>
                </select>
              </div>

              {/* 线条样式 */}
              <div>
                <label className="text-[11px] font-medium text-[var(--fs-text-muted)] block mb-1">
                  线条样式
                </label>
                <select
                  value={selectedEdge.data?.style?.strokeStyle ?? 'solid'}
                  onChange={(e) =>
                    updateEdgeData(selectedEdge.id, {
                      style: { strokeStyle: e.target.value as 'solid' | 'dashed' },
                    })
                  }
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text)] outline-none focus:border-[var(--fs-primary)] cursor-pointer"
                >
                  <option value="solid">实线 (solid)</option>
                  <option value="dashed">虚线 (dashed)</option>
                </select>
              </div>

              {/* 动画流动 */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--fs-bg)] border border-[var(--fs-border)]">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-[var(--fs-text)]">动画流动效果</span>
                  <span className="text-[10px] text-[var(--fs-text-muted)]">呈现流动虚线</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(selectedEdge.data?.style?.animated || selectedEdge.animated)}
                  onClick={() => {
                    const isCurrentlyAnimated = Boolean(
                      selectedEdge.data?.style?.animated || selectedEdge.animated
                    );
                    updateEdgeData(selectedEdge.id, {
                      style: { animated: !isCurrentlyAnimated },
                    });
                  }}
                  className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                    selectedEdge.data?.style?.animated || selectedEdge.animated
                      ? 'bg-[var(--fs-primary)] justify-end'
                      : 'bg-[var(--fs-border)] justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-[var(--fs-surface)] shadow-xs transition-transform" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. 多选状态占位 */}
        {isMultiNodesSelected && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 my-auto space-y-3">
            <div className="w-10 h-10 rounded-full bg-fs-bg border border-fs-border flex items-center justify-center text-fs-primary">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-fs-text">已选中 {selectedNodeIds.length} 个图元</p>
              <p className="text-[11px] text-fs-text-muted mt-1 leading-relaxed">
                可通过画布上方悬浮快捷工具条进行批量成组、解散、对齐或颜色调整
              </p>
            </div>
            <button
              type="button"
              onClick={handleDeselect}
              className="px-3 py-1 text-xs rounded-md bg-fs-bg border border-fs-border text-fs-text-muted hover:text-fs-text transition-colors cursor-pointer"
            >
              取消选中
            </button>
          </div>
        )}

        {/* 4. 未选中图元空态占位 */}
        {!isSingleNodeSelected && !isSingleEdgeSelected && !isMultiNodesSelected && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 my-auto space-y-3">
            <div className="w-10 h-10 rounded-full bg-fs-bg border border-fs-border flex items-center justify-center text-fs-text-muted">
              <MousePointerClick className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-fs-text">未选中任何图元</p>
              <p className="text-[11px] text-fs-text-muted mt-1 leading-relaxed">
                在画布中点击选中任意节点或连线，即可在此查看并实时调整其详细属性
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 底部删除操作栏 (选中节点或连线时展示) */}
      {(isSingleNodeSelected || isSingleEdgeSelected) && (
        <div className="p-3 border-t border-[var(--fs-border)] mt-auto shrink-0 bg-[var(--fs-surface)]">
          <button
            type="button"
            onClick={() => deleteSelected()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--fs-palette-4)] hover:bg-[var(--fs-palette-4)]/10 border border-[var(--fs-palette-4)]/30 hover:border-[var(--fs-palette-4)] transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除当前选中的{isSingleNodeSelected ? '节点' : '连线'}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
