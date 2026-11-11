import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Bot,
  Sparkles,
  Send,
  X,
  RotateCcw,
  Check,
  Play,
  Layers,
  ChevronRight,
  Trash2,
  AlertCircle,
  Command,
} from 'lucide-react';
import { useFlowStore } from '../../stores/flow-store';
import { useCollaboration } from '../collaboration/collaboration-provider';
import { SLASH_COMMANDS } from './copilot-slash-commands';
import { planFromNaturalLanguage } from './copilot-planner';
import { executePlan, revertAiBatch } from './copilot-api';
import type { CopilotMessage, CopilotDryRunPlan } from './copilot-types';

export const CopilotPanel: React.FC = () => {
  const isOpen = useFlowStore((s) => s.copilotOpen);
  const setCopilotOpen = useFlowStore((s) => s.setCopilotOpen);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const setAiReviewMode = useFlowStore((s) => s.setAiReviewMode);
  const showToast = useFlowStore((s) => s.showToast);
  const collab = useCollaboration();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [executingPlanId, setExecutingPlanId] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [includeSelection, setIncludeSelection] = useState(true);

  const prevSelectedIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (selectedNodeIds.length > 0) {
      const prev = prevSelectedIdsRef.current;
      const isChanged = prev.length !== selectedNodeIds.length || selectedNodeIds.some((id) => !prev.includes(id));
      if (isChanged) {
        setIncludeSelection(true);
      }
    }
    prevSelectedIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedNodes = useMemo(() => {
    if (!includeSelection || selectedNodeIds.length === 0) return [];
    return nodes.filter((n) => selectedNodeIds.includes(n.id) || n.selected);
  }, [includeSelection, selectedNodeIds, nodes]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setCopilotOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setCopilotOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSlashMenu(true);
      setSelectedSlashIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  };

  const selectSlashCommand = (cmd: string) => {
    setInput(cmd + ' ');
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const query = (textToSend ?? input).trim();
    if (!query || isProcessing) return;

    setInput('');
    setShowSlashMenu(false);

    const userMsg: CopilotMessage = {
      id: `msg-${Date.now()}-user`,
      sender: 'user',
      text: query,
      timestamp: Date.now(),
      contextNodes: selectedNodes.map((n) => ({
        id: n.id,
        label: String((n.data as any)?.label || (n.data as any)?.laneTitle || n.id),
      })),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    if (collab?.broadcastAiPlanning) {
      collab.broadcastAiPlanning(true, query);
    }

    const assistantMsgId = `msg-${Date.now()}-assistant`;
    const tempAssistantMsg: CopilotMessage = {
      id: assistantMsgId,
      sender: 'assistant',
      text: '',
      timestamp: Date.now(),
      status: 'thinking',
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);

    try {
      await new Promise((r) => setTimeout(r, 400));

      const planResult = planFromNaturalLanguage(
        {
          diagramId: collab?.diagramId || 'default',
          nodes,
          edges,
          selectedNodes,
        },
        query
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: planResult.text,
                plan: planResult.plan,
                status: planResult.plan ? 'ready' : undefined,
              }
            : m
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: '解析或规划异常，请检查输入或稍后重试。',
                status: 'failed',
                error: err.message || String(err),
              }
            : m
        )
      );
    } finally {
      setIsProcessing(false);
      if (collab?.broadcastAiPlanning) {
        collab.broadcastAiPlanning(false);
      }
    }
  }, [input, isProcessing, selectedNodes, collab, nodes, edges]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectSlashCommand(SLASH_COMMANDS[selectedSlashIndex].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyPlan = async (messageId: string, plan: CopilotDryRunPlan) => {
    if (!collab?.diagramId) {
      showToast('当前未处于图表协同会话中');
      return;
    }

    setExecutingPlanId(plan.id);

    try {
      const outcome = await executePlan(collab.diagramId, plan);

      if (outcome.success) {
        showToast('✓ AI 增量操作已应用至画布，已开启 Visual Diff 审阅高亮');

        if (outcome.batchId) {
          setAiReviewMode(true, outcome.batchId);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'applied',
                  reviewBatchId: outcome.batchId,
                }
              : m
          )
        );
      } else {
        showToast(`执行失败: ${outcome.error || '未知错误'}`);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  error: outcome.error,
                }
              : m
          )
        );
      }
    } catch (err: any) {
      showToast(`执行异常: ${err.message || String(err)}`);
    } finally {
      setExecutingPlanId(null);
    }
  };

  const handleAcceptReview = (messageId: string) => {
    setAiReviewMode(false, null);
    showToast('✓ 已全额采纳 AI 批次成果');
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              reviewBatchId: undefined,
            }
          : m
      )
    );
  };

  const handleRevertReview = async (messageId: string, batchId: string) => {
    if (!collab?.diagramId) return;

    try {
      const res = await revertAiBatch(collab.diagramId, batchId);
      if (res.success) {
        showToast(res.message || '已成功撤回本批次修改，人工编辑已安全保留');
        setAiReviewMode(false, null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'reverted',
                  reviewBatchId: undefined,
                }
              : m
          )
        );
      } else {
        showToast(`撤回失败: ${res.error}`);
      }
    } catch (err: any) {
      showToast('撤回请求网络异常');
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      aria-label="AI Copilot 面板"
      className="absolute top-0 right-0 z-40 w-96 h-full flex flex-col bg-fs-surface/95 dark:bg-slate-900/95 backdrop-blur-xl border-l border-fs-border shadow-2xl transition-all duration-200 animate-in slide-in-from-right-4"
    >
      <div className="h-12 px-3.5 flex items-center justify-between border-b border-fs-border bg-fs-bg/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-xs">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-fs-text tracking-wide">AI Copilot</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
            人机共治 · 增量模式
          </span>
        </div>

        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              title="清空对话"
              className="p-1.5 rounded-md text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCopilotOpen(false)}
            title="关闭面板 (Cmd/Ctrl+J)"
            className="p-1.5 rounded-md text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-4 text-fs-text-muted select-none">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-500/20 to-indigo-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm text-fs-text">画布内置 AI 协作者</h3>
              <p className="text-[11px] leading-relaxed">
                基于 MCP 增量协议与 Visual Diff 三色审阅，支持自然语言绘图、异常分支推演与快捷指令。
              </p>
            </div>

            <div className="w-full space-y-1.5 text-left pt-2">
              <span className="text-[10px] font-semibold tracking-wider text-fs-text-muted uppercase">快捷尝试</span>
              <button
                type="button"
                onClick={() => handleSendMessage('/branch 为当前节点补充异常分支')}
                className="w-full p-2 rounded-lg border border-fs-border bg-fs-bg/60 hover:bg-fs-bg hover:border-purple-400/50 transition-all text-left flex items-center gap-2 group cursor-pointer"
              >
                <span className="text-amber-500 font-mono text-[11px] font-semibold">/branch</span>
                <span className="text-[11px] text-fs-text group-hover:text-purple-600 dark:group-hover:text-purple-400">为节点补充校验与驳回分支</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage('/refine 润色选中节点文案与因果排版')}
                className="w-full p-2 rounded-lg border border-fs-border bg-fs-bg/60 hover:bg-fs-bg hover:border-purple-400/50 transition-all text-left flex items-center gap-2 group cursor-pointer"
              >
                <span className="text-emerald-500 font-mono text-[11px] font-semibold">/refine</span>
                <span className="text-[11px] text-fs-text group-hover:text-purple-600 dark:group-hover:text-purple-400">润色命名规范并优化排版</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage('/testcase 生成因果链路测试用例清单')}
                className="w-full p-2 rounded-lg border border-fs-border bg-fs-bg/60 hover:bg-fs-bg hover:border-purple-400/50 transition-all text-left flex items-center gap-2 group cursor-pointer"
              >
                <span className="text-blue-500 font-mono text-[11px] font-semibold">/testcase</span>
                <span className="text-[11px] text-fs-text group-hover:text-purple-600 dark:group-hover:text-purple-400">全链路测试用例推演导出</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage('在订单支付节点后增加风控校验，若未通过则驳回至用户，放到风控泳道')}
                className="w-full p-2 rounded-lg border border-fs-border bg-fs-bg/60 hover:bg-fs-bg hover:border-purple-400/50 transition-all text-left flex items-center gap-2 group cursor-pointer"
              >
                <span className="text-purple-500 font-mono text-[11px] font-semibold">自然语言</span>
                <span className="text-[11px] text-fs-text group-hover:text-purple-600 dark:group-hover:text-purple-400 truncate">在订单支付后增加风控校验...</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col space-y-1.5 ${
                msg.sender === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {msg.contextNodes && msg.contextNodes.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200/50 dark:border-purple-800/50">
                  <Layers className="w-2.5 h-2.5" />
                  <span>选区引用: {msg.contextNodes.map((n) => n.label).join(', ')}</span>
                </div>
              )}

              <div
                className={`max-w-[92%] p-3 rounded-2xl leading-relaxed whitespace-pre-wrap break-words shadow-xs ${
                  msg.sender === 'user'
                    ? 'bg-purple-600 text-white rounded-br-xs'
                    : 'bg-fs-bg text-fs-text border border-fs-border rounded-bl-xs'
                }`}
              >
                {msg.status === 'thinking' ? (
                  <div className="flex items-center gap-2 py-1 text-fs-text-muted">
                    <Sparkles className="w-3.5 h-3.5 animate-spin text-purple-600" />
                    <span>AI 协作者正在规划增量操作...</span>
                  </div>
                ) : (
                  msg.text
                )}

                {msg.error && (
                  <div className="mt-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 flex items-start gap-1.5 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{msg.error}</span>
                  </div>
                )}
              </div>

              {msg.plan && (
                <div className="w-full max-w-[96%] p-3 rounded-xl border border-purple-300 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/40 space-y-2.5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold text-[11px] text-purple-900 dark:text-purple-100">
                      <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      <span>意图预览 (Dry-Run Plan)</span>
                    </div>
                    <span className="text-[10px] text-purple-700 dark:text-purple-300 font-mono">
                      {msg.plan.tool}
                    </span>
                  </div>

                  <p className="text-[11px] text-purple-950 dark:text-purple-200 font-medium">
                    {msg.plan.summary}
                  </p>

                  <div className="p-2 rounded-lg bg-fs-surface/80 dark:bg-slate-900/80 border border-purple-200/50 dark:border-purple-800/50 space-y-1">
                    {msg.plan.details.map((detail, idx) => (
                      <div key={idx} className="text-[10px] font-mono text-fs-text flex items-start gap-1.5">
                        <span className="text-purple-600 dark:text-purple-400 shrink-0">•</span>
                        <span>{detail}</span>
                      </div>
                    ))}
                  </div>

                  {msg.status === 'ready' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={executingPlanId === msg.plan.id}
                        onClick={() => handleApplyPlan(msg.id, msg.plan!)}
                        className="flex-1 py-1.5 px-3 rounded-lg font-medium text-xs bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{executingPlanId === msg.plan.id ? '写入中...' : '确认执行 (Apply)'}</span>
                      </button>
                    </div>
                  )}

                  {msg.status === 'applied' && (
                    <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 space-y-2">
                      <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-200 font-semibold text-[11px]">
                        <span>✓ 已执行入库，Visual Diff 高亮审阅中</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAcceptReview(msg.id)}
                          className="flex-1 py-1 px-2.5 rounded-md font-medium text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors flex items-center justify-center gap-1 shadow-xs"
                        >
                          <Check className="w-3 h-3" />
                          <span>一键采纳</span>
                        </button>
                        {msg.reviewBatchId && (
                          <button
                            type="button"
                            onClick={() => handleRevertReview(msg.id, msg.reviewBatchId!)}
                            className="py-1 px-2.5 rounded-md font-medium text-[11px] bg-fs-surface hover:bg-fs-bg text-rose-600 border border-rose-300 dark:border-rose-800 cursor-pointer transition-colors flex items-center justify-center gap-1 shadow-xs"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>撤回</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {msg.status === 'reverted' && (
                    <div className="text-[10px] text-fs-text-muted italic">
                      ↺ 本批次修改已撤回
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-fs-border bg-fs-surface shrink-0 relative">
        {showSlashMenu && (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-fs-border bg-fs-surface shadow-2xl p-1 text-xs z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2.5 py-1 text-[10px] font-semibold text-fs-text-muted uppercase tracking-wider border-b border-fs-border mb-1">
              快捷指令 (Slash Commands)
            </div>
            {SLASH_COMMANDS.map((item, idx) => (
              <button
                key={item.cmd}
                type="button"
                onClick={() => selectSlashCommand(item.cmd)}
                className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between cursor-pointer transition-colors ${
                  idx === selectedSlashIndex
                    ? 'bg-purple-100 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100'
                    : 'hover:bg-fs-bg text-fs-text'
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-mono font-semibold">{item.cmd}</span>
                  <span className="text-[10px] text-fs-text-muted">{item.desc}</span>
                </div>
                <span className="text-[10px] text-fs-text-muted font-mono">{item.title}</span>
              </button>
            ))}
          </div>
        )}

        {selectedNodes.length > 0 && (
          <div className="mb-2 flex items-center justify-between px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/80 text-[11px] text-purple-900 dark:text-purple-200">
            <div className="flex items-center gap-1.5 truncate">
              <Layers className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
              <span className="font-medium truncate">
                已选中 {selectedNodes.length} 个节点 ({selectedNodes.map((n) => (n.data as any)?.label || n.id).join(', ')})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIncludeSelection(false)}
              className="text-purple-600/70 hover:text-purple-900 dark:hover:text-purple-100 p-0.5 cursor-pointer"
              title="忽略当前选区"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 p-1.5 rounded-xl border border-fs-border bg-fs-bg focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20 transition-all">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入自然语言指令或 / 快捷指令..."
            className="flex-1 bg-transparent border-0 resize-none text-xs text-fs-text placeholder:text-fs-text-muted focus:outline-hidden p-1 leading-relaxed max-h-28"
          />

          <button
            type="button"
            disabled={!input.trim() || isProcessing}
            onClick={() => handleSendMessage()}
            className="p-2 rounded-lg bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="发送指令 (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[10px] text-fs-text-muted px-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => selectSlashCommand('/branch')}
              className="hover:text-purple-600 dark:hover:text-purple-400 font-mono cursor-pointer"
            >
              /branch
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => selectSlashCommand('/refine')}
              className="hover:text-purple-600 dark:hover:text-purple-400 font-mono cursor-pointer"
            >
              /refine
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => selectSlashCommand('/testcase')}
              className="hover:text-purple-600 dark:hover:text-purple-400 font-mono cursor-pointer"
            >
              /testcase
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Command className="w-2.5 h-2.5" />
            <span>J 唤起/折叠</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
