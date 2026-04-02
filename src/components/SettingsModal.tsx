import React, { useEffect, useMemo, useState } from 'react';
import { Settings, X } from 'lucide-react';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  getEffectiveSettings,
  getPersistedSettings,
  getSettingsEnvOverrides,
  maskSecret,
  saveSettings,
} from '../lib/settings';

const toSafeInt = (value: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const FieldLabel = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="mb-1">
    <div className="text-sm font-medium text-slate-800">{title}</div>
    {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
  </div>
);

export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedHint, setSavedHint] = useState('');

  const envOverrides = useMemo(() => getSettingsEnvOverrides(), [open]);
  const effectiveSettings = useMemo(() => getEffectiveSettings(), [open]);

  useEffect(() => {
    if (!open) return;
    setForm(getPersistedSettings());
    setSavedHint('');
  }, [open]);

  const onSave = () => {
    const normalized: AppSettings = {
      aiBaseUrl: form.aiBaseUrl.trim(),
      aiApiKey: form.aiApiKey.trim(),
      aiModel: form.aiModel.trim() || DEFAULT_SETTINGS.aiModel,
      githubToken: form.githubToken.trim(),
      historyStore: form.historyStore.trim(),
      maxRecursionDepth: toSafeInt(String(form.maxRecursionDepth), DEFAULT_SETTINGS.maxRecursionDepth, 1, 6),
      keySubFunctionCount: toSafeInt(String(form.keySubFunctionCount), DEFAULT_SETTINGS.keySubFunctionCount, 1, 30),
    };
    saveSettings(normalized);
    setSavedHint('已保存。若存在环境变量，将优先使用环境变量值。');
  };

  const EnvHint = ({ field, secret }: { field: keyof AppSettings; secret?: boolean }) => {
    const env = envOverrides[field];
    if (!env) return null;
    const rendered = secret ? maskSecret(env.value) : env.value;
    return (
      <div className="mt-1 text-[11px] text-emerald-700">
        环境变量生效中（{env.envKey}）：{rendered}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
      >
        <Settings className="w-4 h-4" />
        设置
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">系统设置</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <FieldLabel title="AI Base URL" />
                <input
                  value={form.aiBaseUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, aiBaseUrl: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="例如 https://generativelanguage.googleapis.com"
                />
                <EnvHint field="aiBaseUrl" />
              </div>

              <div>
                <FieldLabel title="AI API Key" />
                <input
                  type="password"
                  value={form.aiApiKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, aiApiKey: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="填写你的 AI API Key"
                />
                <EnvHint field="aiApiKey" secret />
              </div>

              <div>
                <FieldLabel title="AI 模型名称" />
                <input
                  value={form.aiModel}
                  onChange={(e) => setForm((prev) => ({ ...prev, aiModel: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="例如 gemini-3-flash-preview"
                />
                <EnvHint field="aiModel" />
              </div>

              <div>
                <FieldLabel title="GitHub Token" subtitle="用途：提高 GitHub API 限额并访问私有仓库（若权限允许）" />
                <input
                  type="password"
                  value={form.githubToken}
                  onChange={(e) => setForm((prev) => ({ ...prev, githubToken: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="ghp_xxx..."
                />
                <EnvHint field="githubToken" secret />
              </div>

              <div>
                <FieldLabel title="HISTORY_STORE" subtitle="历史记录存储路径，支持目录或 history.json 文件路径" />
                <input
                  value={form.historyStore}
                  onChange={(e) => setForm((prev) => ({ ...prev, historyStore: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="例如 D:/Project_Store/history.json"
                />
                <EnvHint field="historyStore" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel title="最大下钻层数" subtitle="默认 2，范围 1-6" />
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={form.maxRecursionDepth}
                    onChange={(e) => setForm((prev) => ({ ...prev, maxRecursionDepth: toSafeInt(e.target.value, 2, 1, 6) }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <EnvHint field="maxRecursionDepth" />
                </div>
                <div>
                  <FieldLabel title="关键调用子函数数量" subtitle="默认 10，范围 1-30" />
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={form.keySubFunctionCount}
                    onChange={(e) => setForm((prev) => ({ ...prev, keySubFunctionCount: toSafeInt(e.target.value, 10, 1, 30) }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <EnvHint field="keySubFunctionCount" />
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                启动时如检测到环境变量与本地保存值不一致，将优先使用环境变量。
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                当前生效：模型 `{effectiveSettings.aiModel}`，最大下钻 `{effectiveSettings.maxRecursionDepth}`，子函数数量 `{effectiveSettings.keySubFunctionCount}`，HISTORY_STORE `{effectiveSettings.historyStore || '-'}`。
              </div>
              {savedHint ? <div className="text-xs text-emerald-700">{savedHint}</div> : null}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={onSave}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
