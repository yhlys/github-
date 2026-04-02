import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Search, AlertCircle, History, FolderOpen, Trash2, Loader2 } from 'lucide-react';
import { parseGitHubUrl } from '../lib/dataSource/githubDataSource';
import { deleteAnalysisRecord, getAnalysisRecords } from '../lib/history';
import type { AnalysisRecord } from '../lib/history';
import { createLocalProjectSnapshot } from '../lib/localProjectStore';
import SettingsModal from '../components/SettingsModal';
import ThemeToggle from '../components/ThemeToggle';

type Mode = 'github' | 'local';

export default function Home() {
  const [mode, setMode] = useState<Mode>('github');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [historyRecords, setHistoryRecords] = useState<AnalysisRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingRecordId, setDeletingRecordId] = useState('');
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState('');
  const [localProjectName, setLocalProjectName] = useState('');
  const [localFileCount, setLocalFileCount] = useState(0);
  const [localProjectId, setLocalProjectId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setHistoryLoading(true);
      const records = await getAnalysisRecords();
      setHistoryRecords(records);
      setHistoryLoading(false);
    };
    void load();
  }, []);

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'github') {
      if (!url.trim()) {
        setError('请输入 GitHub 仓库地址');
        return;
      }

      const repoInfo = parseGitHubUrl(url);
      if (!repoInfo) {
        setError('无效的 GitHub 地址，请提供正确的仓库链接。');
        return;
      }

      navigate(`/analyze/${repoInfo.owner}/${repoInfo.repo}`);
      return;
    }

    if (!localProjectId) {
      setError('请先选择本地项目目录');
      return;
    }

    navigate(`/analyze/local?projectId=${encodeURIComponent(localProjectId)}`);
  };

  const openHistory = (record: AnalysisRecord) => {
    if (record.sourceKind === 'local') {
      const projectIdPart = record.localProjectId ? `&projectId=${encodeURIComponent(record.localProjectId)}` : '';
      navigate(`/analyze/local?historyId=${record.id}${projectIdPart}`);
      return;
    }
    navigate(`/analyze/${record.owner || ''}/${record.repo || ''}?historyId=${record.id}`);
  };

  const getRecordSourceKind = (record: AnalysisRecord): 'github' | 'local' => {
    if (record.sourceKind === 'local' || record.sourceKind === 'github') return record.sourceKind;
    return record.owner && record.repo ? 'github' : 'local';
  };

  const handleDeleteHistory = async (record: AnalysisRecord) => {
    if (deletingRecordId === record.id) return;
    const ok = window.confirm(`确认删除历史记录「${record.projectName || record.repo || record.id}」吗？`);
    if (!ok) return;
    setDeletingRecordId(record.id);
    await deleteAnalysisRecord(record.id);
    setHistoryRecords((prev) => prev.filter((item) => item.id !== record.id));
    setDeleteSuccessMessage(`已删除历史记录：${record.projectName || record.repo || record.id}`);
    window.setTimeout(() => setDeleteSuccessMessage(''), 1800);
    setDeletingRecordId('');
  };

  const handlePickLocalFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const files = Array.from(e.target.files || []);
    if (!files.length) {
      setLocalProjectName('');
      setLocalFileCount(0);
      setLocalProjectId('');
      return;
    }

    const snapshot = createLocalProjectSnapshot(files);
    if (!snapshot) {
      setError('本地目录读取失败，请重试');
      return;
    }

    setLocalProjectName(snapshot.name);
    setLocalFileCount(snapshot.files.length);
    setLocalProjectId(snapshot.id);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
        <ThemeToggle />
        <SettingsModal />
      </div>
      <div className="max-w-4xl w-full space-y-8 text-center">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="p-4 bg-indigo-100 rounded-2xl">
            <Github className="w-16 h-16 text-indigo-600" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">GitHub 代码分析器</h1>
          <p className="text-lg text-slate-600 max-w-xl mx-auto">
            可视化项目结构并即时分析代码。支持 GitHub 仓库和本地项目。
          </p>
        </div>

        <div className="max-w-xl mx-auto rounded-xl border border-slate-200 bg-white p-1 flex">
          <button
            type="button"
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${mode === 'github' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => {
              setMode('github');
              setError('');
            }}
          >
            GitHub 项目
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${mode === 'local' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => {
              setMode('local');
              setError('');
            }}
          >
            本地项目
          </button>
        </div>

        <form onSubmit={handleAnalyze} className="mt-8 space-y-4">
          {mode === 'github' ? (
            <div className="relative max-w-xl mx-auto">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="block w-full pl-11 pr-32 py-4 text-base rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                placeholder="https://github.com/owner/repo"
              />
              <button
                type="submit"
                className="absolute inset-y-2 right-2 flex items-center px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                分析
              </button>
            </div>
          ) : (
            <div className="max-w-xl mx-auto rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-left">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handlePickLocalFolder}
                className="hidden"
                {...({ webkitdirectory: 'true', directory: 'true' } as any)}
              />
              <button
                type="button"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen className="w-4 h-4" />
                选择本地项目目录
              </button>
              <div className="text-sm text-slate-600">
                {localProjectId ? `已选择：${localProjectName}（${localFileCount} 个文件）` : '尚未选择目录'}
              </div>
              <button
                type="submit"
                disabled={!localProjectId}
                className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                分析本地项目
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center space-x-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
          {deleteSuccessMessage && (
            <div className="flex items-center justify-center space-x-2 text-emerald-700 text-sm">
              <span>{deleteSuccessMessage}</span>
            </div>
          )}
        </form>

        <div className="max-w-4xl mx-auto text-left">
            <div className="flex items-center gap-2 mb-3 text-slate-700">
              <History className="w-4 h-4" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">历史分析记录</h2>
            </div>

            {historyLoading ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                历史记录载入中...
              </div>
            ) : historyRecords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                暂无历史记录，先分析一个仓库吧。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {historyRecords.map((record) => (
                  <div
                    key={record.id}
                    onClick={() => openHistory(record)}
                    className="relative text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteHistory(record);
                      }}
                      disabled={deletingRecordId === record.id}
                      className="absolute right-3 bottom-3 p-1.5 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      title="删除历史记录"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className={`absolute right-3 top-3 px-2 py-0.5 rounded-full border text-[11px] font-medium ${
                        getRecordSourceKind(record) === 'local'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-sky-200 bg-sky-50 text-sky-700'
                      }`}
                    >
                      {getRecordSourceKind(record) === 'local' ? '本地' : 'GitHub'}
                    </span>
                    <div className="font-semibold text-slate-900 line-clamp-1">{record.projectName || record.repo}</div>
                    <div className="text-xs text-slate-500 mt-1 line-clamp-1">{record.projectUrl}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-100 text-slate-700 text-xs">
                        语言：{record.aiResult?.primaryLanguage || '-'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full border text-xs ${record.sourceKind === 'local' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                        {record.sourceKind === 'local' ? '本地项目' : `${record.owner}/${record.repo}`}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 line-clamp-1">{record.aiResult?.summary || '暂无项目摘要'}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

