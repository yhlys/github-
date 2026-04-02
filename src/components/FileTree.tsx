import React, { useEffect, useRef, useState } from 'react';
import { FileNode } from '../lib/dataSource/types';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import { clsx } from 'clsx';

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (node: FileNode) => void;
  selectedPath?: string;
}

export default function FileTree({ nodes, onSelectFile, selectedPath }: FileTreeProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  onSelectFile,
  selectedPath,
}: {
  node: FileNode;
  onSelectFile: (node: FileNode) => void;
  selectedPath?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isSelected = selectedPath === node.path;
  const isFolder = node.type === 'tree';

  useEffect(() => {
    if (!isFolder || !selectedPath) return;
    if (selectedPath.startsWith(`${node.path}/`)) {
      setIsOpen(true);
    }
  }, [isFolder, node.path, selectedPath]);

  useEffect(() => {
    if (!isSelected) return;
    const id = window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [isSelected]);

  const handleClick = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  return (
    <li>
      <div
        ref={rowRef}
        className={clsx(
          'file-tree-node flex items-center py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors',
          isSelected
            ? 'file-tree-node-selected bg-indigo-100 text-indigo-900 font-medium'
            : 'text-slate-700 hover:bg-slate-100'
        )}
        onClick={handleClick}
      >
        <span className="w-5 h-5 flex items-center justify-center mr-1 text-slate-400">
          {isFolder ? (
            isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <span className="w-4 h-4" /> // Spacer
          )}
        </span>
        
        <span className="w-5 h-5 flex items-center justify-center mr-2 text-slate-500">
          {isFolder ? (
            <Folder className={clsx("w-4 h-4", isOpen ? "fill-indigo-200 text-indigo-500" : "fill-slate-200")} />
          ) : (
            <File className="w-4 h-4" />
          )}
        </span>
        
        <span className="truncate">{node.name}</span>
      </div>
      
      {isFolder && isOpen && node.children && (
        <div className="pl-4 ml-2 border-l border-slate-200 mt-1">
          <FileTree
            nodes={node.children}
            onSelectFile={onSelectFile}
            selectedPath={selectedPath}
          />
        </div>
      )}
    </li>
  );
}
