import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeViewerProps {
  code: string;
  language: string;
  fileName: string;
  highlightLine?: number | null;
  focusKey?: string;
}

const LARGE_FILE_CHAR_THRESHOLD = 250_000;
const LARGE_FILE_LINE_HEIGHT = 22;
const LARGE_FILE_OVERSCAN = 120;
const LARGE_FILE_SIDE_PADDING = 24;

const stripThemeBackground = (theme: Record<string, any>): Record<string, any> => {
  const next: Record<string, any> = {};
  Object.entries(theme).forEach(([key, value]) => {
    if (value && typeof value === 'object') {
      next[key] = {
        ...value,
        background: 'transparent',
        backgroundColor: 'transparent',
      };
      return;
    }
    next[key] = value;
  });
  return next;
};

export default function CodeViewer({ code, language, fileName, highlightLine, focusKey }: CodeViewerProps) {
  const containerId = useMemo(() => `code-view-${Math.random().toString(36).slice(2)}`, []);
  const largeFileScrollRef = useRef<HTMLDivElement | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [showLargeFileHint, setShowLargeFileHint] = useState(false);
  const usePlainTextMode = code.length > LARGE_FILE_CHAR_THRESHOLD;
  const allLines = useMemo(() => (usePlainTextMode ? code.split('\n') : []), [code, usePlainTextMode]);
  const lightTheme = useMemo(() => stripThemeBackground(oneLight as any), []);
  const darkTheme = useMemo(() => stripThemeBackground(oneDark as any), []);
  const totalLineCount = allLines.length;
  const totalHeight = totalLineCount * LARGE_FILE_LINE_HEIGHT;
  const visibleStart = useMemo(
    () => Math.max(0, Math.floor(scrollTop / LARGE_FILE_LINE_HEIGHT) - LARGE_FILE_OVERSCAN),
    [scrollTop],
  );
  const visibleEnd = useMemo(
    () => Math.min(totalLineCount, Math.ceil((scrollTop + viewportHeight) / LARGE_FILE_LINE_HEIGHT) + LARGE_FILE_OVERSCAN),
    [scrollTop, viewportHeight, totalLineCount],
  );
  const visibleLines = useMemo(() => allLines.slice(visibleStart, visibleEnd), [allLines, visibleStart, visibleEnd]);
  const visibleCodeText = useMemo(() => visibleLines.join('\n'), [visibleLines]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (usePlainTextMode) {
      setShowLargeFileHint(true);
    } else {
      setShowLargeFileHint(false);
    }
  }, [usePlainTextMode, fileName]);

  useEffect(() => {
    if (!usePlainTextMode) return;
    const scroller = largeFileScrollRef.current;
    if (!scroller) return;

    const syncViewportHeight = () => setViewportHeight(scroller.clientHeight || 0);
    syncViewportHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncViewportHeight);
      ro.observe(scroller);
      return () => ro.disconnect();
    }

    const onResize = () => syncViewportHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [usePlainTextMode]);

  useEffect(() => {
    if (!highlightLine || highlightLine < 1) return;
    if (usePlainTextMode) {
      const scroller = largeFileScrollRef.current;
      if (!scroller) return;
      const target = Math.max(
        0,
        (highlightLine - 1) * LARGE_FILE_LINE_HEIGHT - scroller.clientHeight / 2 + LARGE_FILE_LINE_HEIGHT / 2,
      );
      scroller.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }

    const selector = `#${containerId} [data-line-number="${highlightLine}"]`;
    const el = document.querySelector(selector);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightLine, focusKey, containerId, code, usePlainTextMode]);

  return (
    <div className="h-full flex flex-col bg-white rounded-xl overflow-hidden shadow-sm border border-slate-200">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-mono text-slate-600">{fileName}</span>
          {usePlainTextMode ? (
            <span className="text-[11px] px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
              Large file mode
            </span>
          ) : null}
        </div>
        <div className="flex space-x-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
      </div>
      {usePlainTextMode && showLargeFileHint ? (
        <div className="px-4 py-2 border-b border-amber-200 bg-amber-50 text-[12px] text-amber-800 flex items-center justify-between">
          <span>已进入大文件模式：启用虚拟渲染与局部高亮，保证流畅滚动和函数定位。</span>
          <button
            type="button"
            className="ml-3 px-2 py-0.5 rounded border border-amber-300 hover:bg-amber-100"
            onClick={() => setShowLargeFileHint(false)}
          >
            知道了
          </button>
        </div>
      ) : null}
      <div id={containerId} className="flex-1 overflow-auto">
        {usePlainTextMode ? (
          <div
            ref={largeFileScrollRef}
            className="h-full overflow-auto font-mono text-[13px]"
            onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
          >
            <div style={{ height: totalHeight, position: 'relative', minWidth: '100%' }}>
              <div
                style={{
                  position: 'absolute',
                  top: visibleStart * LARGE_FILE_LINE_HEIGHT,
                  left: 0,
                  paddingLeft: LARGE_FILE_SIDE_PADDING,
                  paddingRight: LARGE_FILE_SIDE_PADDING,
                  display: 'flex',
                  alignItems: 'flex-start',
                  minWidth: '100%',
                }}
              >
                <div
                  style={{
                    width: 54,
                    flexShrink: 0,
                    textAlign: 'right',
                    paddingRight: 12,
                    color: isDark ? '#64748b' : '#94a3b8',
                  }}
                >
                  {visibleLines.map((_, idx) => {
                    const lineNo = visibleStart + idx + 1;
                    return (
                      <div
                        key={`ln-${lineNo}`}
                        style={{
                          height: LARGE_FILE_LINE_HEIGHT,
                          lineHeight: `${LARGE_FILE_LINE_HEIGHT}px`,
                          backgroundColor:
                            highlightLine && lineNo === highlightLine
                              ? isDark
                                ? 'rgba(99, 102, 241, 0.2)'
                                : 'rgba(199, 210, 254, 0.7)'
                              : 'transparent',
                        }}
                      >
                        {lineNo}
                      </div>
                    );
                  })}
                </div>
                <div style={{ minWidth: 'max-content', flex: 1 }}>
                  <SyntaxHighlighter
                    language={language}
                    style={isDark ? darkTheme : lightTheme}
                    customStyle={{
                      margin: 0,
                      padding: 0,
                      background: 'transparent',
                      fontSize: '13px',
                      lineHeight: `${LARGE_FILE_LINE_HEIGHT}px`,
                    }}
                    showLineNumbers={false}
                    wrapLines
                    wrapLongLines={false}
                    lineProps={(relativeLineNo) => {
                      const actualLineNo = visibleStart + relativeLineNo;
                      return {
                        'data-line-number': String(actualLineNo),
                        style: {
                          display: 'block',
                          minHeight: LARGE_FILE_LINE_HEIGHT,
                          backgroundColor:
                            highlightLine && actualLineNo === highlightLine
                              ? isDark
                                ? 'rgba(99, 102, 241, 0.2)'
                                : 'rgba(199, 210, 254, 0.7)'
                              : 'transparent',
                        },
                      };
                    }}
                  >
                    {visibleCodeText}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={isDark ? darkTheme : lightTheme}
            customStyle={{
              margin: 0,
              padding: '1.5rem',
              background: 'transparent',
              fontSize: '14px',
              lineHeight: '1.5',
            }}
            showLineNumbers
            lineNumberStyle={{
              minWidth: '2.25em',
              color: isDark ? '#64748b' : '#94a3b8',
            }}
            wrapLines
            lineProps={(lineNumber) => ({ 'data-line-number': String(lineNumber) })}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
