import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Terminal, Maximize2, Minimize2, Loader2, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';

export interface LogDetail {
  label: string;
  data: any;
}

export interface LogEntry {
  id: string;
  time: Date;
  message: string;
  type: 'info' | 'success' | 'error';
  details?: LogDetail[];
}

export interface AiStats {
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
}

function truncateString(str: string): string {
  if (str.length > 500) {
    const encoder = new TextEncoder();
    const remainingBytes = encoder.encode(str.slice(500)).length;
    return `${str.slice(0, 500)}···后续还有 ${remainingBytes} 字节`;
  }
  return str;
}

function truncateJson(obj: any): any {
  if (typeof obj === 'string') {
    return truncateString(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(truncateJson);
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = truncateJson(obj[key]);
    }
    return newObj;
  }
  return obj;
}

export default function LogPanel({
  logs,
  workflowRunning,
  aiStats,
}: {
  logs: LogEntry[];
  workflowRunning: boolean;
  aiStats: AiStats;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isFullscreen]);

  return (
    <>
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      <div
        className={clsx(
          'flex flex-col border border-slate-200 bg-slate-900 overflow-hidden shadow-sm transition-all duration-200',
          isFullscreen ? 'fixed inset-4 md:inset-10 z-50 rounded-xl shadow-2xl' : 'h-64 rounded-xl mb-6',
        )}
      >
        <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-400 mr-2" />
              <span className="text-xs font-medium text-slate-300 uppercase tracking-wider">工作日志</span>
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  workflowRunning ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
                )}
              >
                {workflowRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {workflowRunning ? '工作中' : '已结束'}
              </span>
            </div>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
              title={isFullscreen ? '退出全屏' : '全屏显示'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[10px] text-slate-300">
            <span className="px-2 py-1 rounded bg-slate-700/70">调用次数: {aiStats.totalCalls}</span>
            <span className="px-2 py-1 rounded bg-slate-700/70">输入Token: {aiStats.inputTokens}</span>
            <span className="px-2 py-1 rounded bg-slate-700/70">输出Token: {aiStats.outputTokens}</span>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs">
          {logs.map((log) => (
            <LogItem key={log.id} log={log} />
          ))}
          {logs.length === 0 && <div className="text-slate-500 text-center mt-4">暂无日志</div>}
        </div>
      </div>
    </>
  );
}

function LogItem({ log }: { log: LogEntry }) {
  const timeStr = log.time.toLocaleTimeString('zh-CN', { hour12: false });

  const colorClass =
    log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300';

  return (
    <div className="space-y-1 py-0.5">
      <div className="flex items-start space-x-2">
        <span className="text-slate-500 shrink-0">[{timeStr}]</span>
        <span className={clsx('flex-1 break-words', colorClass)}>{log.message}</span>
      </div>

      {log.details && log.details.map((detail, idx) => <LogItemDetail key={idx} label={detail.label} data={detail.data} />)}
    </div>
  );
}

function LogItemDetail({ label, data }: { label: string; data: any }) {
  if (
    data &&
    typeof data === 'object' &&
    ('request' in data || 'response' in data)
  ) {
    return (
      <div className="mt-1 space-y-1">
        {'request' in data && <JsonDetailToggle label="AI 请求" data={data.request} />}
        {'response' in data && <JsonDetailToggle label="AI 响应" data={data.response} />}
      </div>
    );
  }

  return <JsonDetailToggle label={label} data={data} />;
}

function JsonDetailToggle({ label, data }: { label: string; data: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1 ml-14">
      <div
        className="inline-flex items-center space-x-1 cursor-pointer text-slate-400 hover:text-slate-300 bg-slate-800/50 hover:bg-slate-800 px-2 py-1 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {expanded && (
        <div className="mt-1">
          <div className="bg-slate-950 rounded p-2 overflow-x-auto border border-slate-800">
            <pre className="text-slate-400 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(truncateJson(data), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
