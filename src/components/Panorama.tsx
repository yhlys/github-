import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SubFunctionAnalysisResult } from '../lib/ai';
import { ChevronDown, ChevronUp, FileCode2, FoldHorizontal, FunctionSquare, Info, UnfoldHorizontal } from 'lucide-react';

const nodeWidth = 280;
const nodeHeight = 170;

const getLayoutedElements = (nodes: any[], edges: any[]) => {
  const childrenMap: Record<string, string[]> = {};
  const nodeById: Record<string, any> = {};
  nodes.forEach((n) => {
    nodeById[n.id] = n;
  });
  edges.forEach((e) => {
    const s = String(e.source || '');
    const t = String(e.target || '');
    if (!s || !t) return;
    if (!childrenMap[s]) childrenMap[s] = [];
    childrenMap[s].push(t);
  });

  const X_GAP = 360;
  const Y_GAP = 220;
  const posMap: Record<string, { x: number; y: number }> = {};
  let cursorY = 0;
  const visiting = new Set<string>();
  const laidOut = new Set<string>();
  const maxDepth = Math.max(6, nodes.length + 2);

  const layoutSubtree = (id: string, depth: number) => {
    if (!nodeById[id]) return;
    if (laidOut.has(id)) return;
    if (visiting.has(id) || depth > maxDepth) {
      posMap[id] = { x: Math.min(depth, maxDepth) * X_GAP, y: cursorY * Y_GAP };
      cursorY += 1;
      laidOut.add(id);
      return;
    }
    visiting.add(id);

    const children = childrenMap[id] || [];
    if (children.length === 0) {
      posMap[id] = { x: depth * X_GAP, y: cursorY * Y_GAP };
      cursorY += 1;
      visiting.delete(id);
      laidOut.add(id);
      return;
    }

    for (const childId of children) {
      if (!nodeById[childId]) continue;
      layoutSubtree(childId, depth + 1);
    }

    const placedChildren = children.filter((childId) => !!posMap[childId]);
    if (placedChildren.length === 0) {
      posMap[id] = { x: depth * X_GAP, y: cursorY * Y_GAP };
      cursorY += 1;
      visiting.delete(id);
      laidOut.add(id);
      return;
    }
    const firstY = posMap[placedChildren[0]].y;
    const lastY = posMap[placedChildren[placedChildren.length - 1]].y;
    posMap[id] = { x: depth * X_GAP, y: Math.round((firstY + lastY) / 2) };
    visiting.delete(id);
    laidOut.add(id);
  };

  if (nodeById.root) {
    layoutSubtree('root', 0);
  }

  nodes.forEach((n) => {
    if (!posMap[n.id]) {
      posMap[n.id] = { x: 0, y: cursorY * Y_GAP };
      cursorY += 1;
    }
  });

  const newNodes = nodes.map((node) => ({
    ...node,
    targetPosition: 'left',
    sourcePosition: 'right',
    position: posMap[node.id] || { x: 0, y: 0 },
  }));

  return { nodes: newNodes, edges };
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const normalized = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
};

const getTextColorByBg = (bg: string): string => {
  const rgb = hexToRgb(bg);
  if (!rgb) return '#0f172a';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
};

const CustomNode = ({ data }: NodeProps) => {
  const needsAnalysis = data.needsFurtherAnalysis as number;
  const filePath = data.filePath as string;
  const functionName = data.functionName as string;
  const description = data.description as string;
  const isRoot = data.isRoot as boolean;
  const moduleName = data.moduleName as string;
  const moduleColor = (data.moduleColor as string) || '#cbd5e1';
  const isDimmed = !!data.isDimmed;
  const onOpenSource = data.onOpenSource as ((payload: { filePath: string; functionName: string; nodeId: string; sourceFilePath?: string; sourceFunctionName?: string }) => void) | undefined;
  const routeUrl = data.routeUrl as string | undefined;

  const hasChildren = !!data.hasChildren;
  const isExpanded = !!data.isExpanded;
  const canManualDrill = !!data.canManualDrill;
  const manualLoading = !!data.manualLoading;
  const onToggleExpand = data.onToggleExpand as ((nodeId: string) => void) | undefined;
  const onManualDrill = data.onManualDrill as ((nodeId: string) => void) | undefined;
  const nodeId = String(data.nodeId || '');

  let statusColor = 'bg-slate-100 border-slate-200';
  let statusText = 'Unknown';
  if (needsAnalysis === 1) {
    statusColor = 'bg-blue-50 border-blue-200';
    statusText = 'Need deeper analysis';
  } else if (needsAnalysis === -1) {
    statusColor = 'bg-slate-50 border-slate-200';
    statusText = 'No drill needed';
  } else if (needsAnalysis === 0) {
    statusColor = 'bg-amber-50 border-amber-200';
    statusText = 'Drill optional';
  }

  return (
    <div className={`relative w-[280px] ${isDimmed ? 'opacity-25 saturate-0' : 'opacity-100'}`}>
      <div
        className={`rounded-xl border-2 shadow-sm bg-white overflow-hidden flex flex-col ${statusColor}`}
        onClick={() =>
          onOpenSource?.({
            filePath: String(filePath || ''),
            functionName: functionName || '',
            nodeId,
            sourceFilePath: String(data.sourceFilePath || ''),
            sourceFunctionName: String(data.sourceFunctionName || ''),
          })
        }
        title="Click to open source and focus function"
      >
        <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-indigo-400" />

        <div
          className="px-3 py-2 border-b border-slate-100 flex items-center justify-between"
          style={{ backgroundColor: moduleColor, color: getTextColorByBg(moduleColor) }}
        >
          <div className="flex items-center space-x-1.5 overflow-hidden">
            <FileCode2 className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-mono truncate" title={filePath}>
              {filePath || 'Unknown file'}
            </span>
          </div>
          {isRoot ? (
            <span className="px-1.5 py-0.5 bg-white/70 text-[10px] font-bold rounded shrink-0">Entry</span>
          ) : (
            <span className="px-1.5 py-0.5 bg-white/70 text-[10px] rounded shrink-0">{moduleName || 'Unassigned'}</span>
          )}
        </div>

        <div className="p-3 flex-1 flex flex-col">
          <div className="flex items-start space-x-2 mb-2">
            <FunctionSquare className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
            <h3 className="text-sm font-bold text-slate-800 break-all leading-tight">{functionName}</h3>
          </div>
          {routeUrl ? (
            <div className="mb-2">
              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono break-all" title={routeUrl}>
                URL: {routeUrl}
              </span>
            </div>
          ) : null}

          <div className="flex items-start space-x-1.5 mt-auto">
            <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-500 line-clamp-2" title={description}>
              {description}
            </p>
          </div>
          <div className="mt-2">
            <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded">{statusText}</span>
          </div>
        </div>

        <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-indigo-400" />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 -bottom-4 z-20 flex items-center">
        {hasChildren ? (
          <button
            type="button"
            className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 shadow hover:bg-indigo-50"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.(nodeId);
            }}
            title={isExpanded ? 'Collapse children' : 'Expand children'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        ) : canManualDrill ? (
          <button
            type="button"
            className="nodrag nopan inline-flex h-8 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-medium text-emerald-700 shadow hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={(e) => {
              e.stopPropagation();
              onManualDrill?.(nodeId);
            }}
            disabled={manualLoading}
            title="继续下钻（单层）"
          >
            {manualLoading ? '下钻中...' : '继续下钻'}
          </button>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300 shadow">
            ·
          </span>
        )}
      </div>
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

interface PanoramaProps {
  entryFile: { path: string; reason: string; functionName: string };
  subFunctions: (SubFunctionAnalysisResult & { id?: string; parentId?: string })[];
  functionToModule?: Record<string, string>;
  moduleColorMap?: Record<string, string>;
  activeModule?: string | null;
  onOpenSource?: (payload: { filePath: string; functionName: string; nodeId: string; sourceFilePath?: string; sourceFunctionName?: string }) => void;
  onManualDrill?: (payload: { nodeId: string }) => void;
  manualDrillingNodeId?: string | null;
}

export default function Panorama({
  entryFile,
  subFunctions,
  functionToModule = {},
  moduleColorMap = {},
  activeModule = null,
  onOpenSource,
  onManualDrill,
  manualDrillingNodeId = null,
}: PanoramaProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isDark, setIsDark] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set(['root']));
  const prevEntryKeyRef = useRef<string>('');
  const prevExpandableIdsRef = useRef<Set<string>>(new Set());
  const onOpenSourceRef = useRef(onOpenSource);
  const onManualDrillRef = useRef(onManualDrill);

  useEffect(() => {
    onOpenSourceRef.current = onOpenSource;
  }, [onOpenSource]);

  useEffect(() => {
    onManualDrillRef.current = onManualDrill;
  }, [onManualDrill]);

  const stableOpenSource = useCallback((payload: { filePath: string; functionName: string; nodeId: string; sourceFilePath?: string; sourceFunctionName?: string }) => {
    onOpenSourceRef.current?.(payload);
  }, []);

  const stableManualDrill = useCallback((payload: { nodeId: string }) => {
    onManualDrillRef.current?.(payload);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const childMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (let i = 0; i < subFunctions.length; i++) {
      const sf = subFunctions[i] as any;
      const sourceId = String(sf.parentId || 'root');
      const targetId = String(sf.id || `sub-${i}`);
      if (!map[sourceId]) map[sourceId] = [];
      map[sourceId].push(targetId);
    }
    return map;
  }, [subFunctions]);

  useEffect(() => {
    const allExpandable = new Set<string>();
    if ((childMap.root || []).length > 0) allExpandable.add('root');
    Object.keys(childMap).forEach((id) => {
      if ((childMap[id] || []).length > 0) allExpandable.add(id);
    });

    const entryKey = `${entryFile.path}@@${entryFile.functionName}`;
    const isEntryChanged = prevEntryKeyRef.current !== entryKey;
    const prevExpandableIds = prevExpandableIdsRef.current;

    setExpandedNodeIds((prev) => {
      if (isEntryChanged) return new Set(allExpandable);

      const next = new Set<string>();
      prev.forEach((id) => {
        if (allExpandable.has(id)) next.add(id);
      });
      allExpandable.forEach((id) => {
        if (!prevExpandableIds.has(id)) next.add(id);
      });
      if (next.size === 0 && allExpandable.has('root')) next.add('root');
      return next;
    });

    prevEntryKeyRef.current = entryKey;
    prevExpandableIdsRef.current = new Set(allExpandable);
  }, [entryFile.path, entryFile.functionName, childMap]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        const stack = [nodeId];
        while (stack.length > 0) {
          const current = stack.pop() as string;
          next.delete(current);
          const children = childMap[current] || [];
          for (const childId of children) {
            if (next.has(childId)) stack.push(childId);
          }
        }
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allExpandable = new Set<string>();
    if ((childMap.root || []).length > 0) allExpandable.add('root');
    Object.keys(childMap).forEach((id) => {
      if ((childMap[id] || []).length > 0) allExpandable.add(id);
    });
    setExpandedNodeIds(allExpandable);
  };

  const collapseAll = () => {
    setExpandedNodeIds(new Set());
  };

  useEffect(() => {
    const getModuleMeta = (id: string) => {
      const moduleName = functionToModule[id] || 'Unassigned';
      const moduleColor = moduleColorMap[moduleName] || '#e2e8f0';
      const isDimmed = !!activeModule && moduleName !== activeModule;
      return { moduleName, moduleColor, isDimmed };
    };

    const visibleNodeIds = new Set<string>(['root']);
    const walkVisible = (id: string) => {
      if (!expandedNodeIds.has(id)) return;
      const children = childMap[id] || [];
      for (const childId of children) {
        if (!visibleNodeIds.has(childId)) {
          visibleNodeIds.add(childId);
          walkVisible(childId);
        }
      }
    };
    walkVisible('root');

    const rootMeta = getModuleMeta('root');
    const allNodes = [
      {
        id: 'root',
        type: 'custom',
        data: {
          functionName: entryFile.functionName,
          description: entryFile.reason,
          filePath: entryFile.path,
          needsFurtherAnalysis: 1,
          isRoot: true,
          nodeId: 'root',
          sourceFilePath: entryFile.path,
          sourceFunctionName: entryFile.functionName,
          hasChildren: (childMap.root || []).length > 0,
          isExpanded: expandedNodeIds.has('root'),
          onToggleExpand: toggleExpand,
          canManualDrill: false,
          manualLoading: false,
          onManualDrill: (id: string) => stableManualDrill({ nodeId: id }),
          onOpenSource: stableOpenSource,
          ...rootMeta,
        },
        position: { x: 0, y: 0 },
      },
      ...subFunctions.map((sf, index) => {
        const nodeId = sf.id || `sub-${index}`;
        const meta = getModuleMeta(nodeId);
        const children = childMap[nodeId] || [];
        const hasChildren = children.length > 0;
        const canManualDrill = !hasChildren && sf.needsFurtherAnalysis !== -1;
        return {
          id: nodeId,
          type: 'custom',
          data: {
            functionName: sf.functionName,
            description: sf.description,
            filePath: sf.possibleFilePath,
            needsFurtherAnalysis: sf.needsFurtherAnalysis,
            nodeId,
            sourceFilePath: (sf as any).sourceFilePath || '',
            sourceFunctionName: (sf as any).sourceFunctionName || '',
            routeUrl: (sf as any).routeUrl || '',
            hasChildren,
            isExpanded: expandedNodeIds.has(nodeId),
            onToggleExpand: toggleExpand,
            canManualDrill,
            manualLoading: manualDrillingNodeId === nodeId,
            onManualDrill: (id: string) => stableManualDrill({ nodeId: id }),
            onOpenSource: stableOpenSource,
            ...meta,
          },
          position: { x: 0, y: 0 },
        };
      }),
    ];

    const allEdges = subFunctions
      .map((sf, index) => {
        const targetId = sf.id || `sub-${index}`;
        const sourceId = sf.parentId || 'root';
        const sourceModule = functionToModule[sourceId] || 'Unassigned';
        const edgeColor = moduleColorMap[sourceModule] || '#818cf8';
        const isDimmed = !!activeModule && sourceModule !== activeModule && (functionToModule[targetId] || 'Unassigned') !== activeModule;
        return {
          id: `e-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          type: 'smoothstep',
          animated: !isDimmed,
          style: { stroke: edgeColor, strokeWidth: isDark ? 2.4 : 2, opacity: isDimmed ? 0.22 : 0.95 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
          },
        };
      })
      .filter(Boolean) as any[];

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(allNodes, allEdges);
    const stabilizedNodes = layoutedNodes.map((node: any) => ({
      ...node,
      hidden: !visibleNodeIds.has(node.id),
    }));
    const stabilizedEdges = layoutedEdges.map((edge: any) => ({
      ...edge,
      hidden: !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target),
    }));

    setNodes(stabilizedNodes);
    setEdges(stabilizedEdges);
  }, [
    entryFile,
    subFunctions,
    functionToModule,
    moduleColorMap,
    activeModule,
    stableOpenSource,
    stableManualDrill,
    manualDrillingNodeId,
    expandedNodeIds,
    childMap,
    isDark,
    setNodes,
    setEdges,
  ]);

  return (
    <div className={`w-full h-full relative ${isDark ? 'bg-slate-950/70' : 'bg-slate-50/50'}`}>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={expandAll}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
          title="Expand all"
        >
          <UnfoldHorizontal className="w-3.5 h-3.5" />
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
          title="Collapse all"
        >
          <FoldHorizontal className="w-3.5 h-3.5" />
          Collapse all
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={1.5}
        attributionPosition="bottom-right"
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background color={isDark ? '#334155' : '#cbd5e1'} gap={18} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const moduleName = String(node.data?.moduleName || 'Unassigned');
            return moduleColorMap[moduleName] || '#cbd5e1';
          }}
          bgColor={isDark ? '#0f172a' : '#f8fafc'}
          maskColor={isDark ? 'rgba(15, 23, 42, 0.65)' : 'rgba(248, 250, 252, 0.7)'}
          style={{
            border: `1px solid ${isDark ? '#334155' : '#cbd5e1'}`,
            backgroundColor: isDark ? '#0f172a' : '#f8fafc',
          }}
        />
      </ReactFlow>
    </div>
  );
}





