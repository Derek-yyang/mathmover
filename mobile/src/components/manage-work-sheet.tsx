import { useEffect, useState } from 'react';
import type { WorkItem } from '../lib/store';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ManageWorkSheetProps {
  work: WorkItem | null;
  onClose: () => void;
  onRename: (work: WorkItem, title: string) => void;
  onDelete: (work: WorkItem) => void;
}

export function ManageWorkSheet({
  work,
  onClose,
  onRename,
  onDelete,
}: ManageWorkSheetProps) {
  const [title, setTitle] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!work) return;
    setTitle(work.title);
    setConfirming(false);
  }, [work]);

  const nextTitle = title.trim();
  const canSave = Boolean(work) && Boolean(nextTitle) && nextTitle !== work?.title;

  function save() {
    if (!work || !canSave) return;
    onRename(work, nextTitle.slice(0, 40));
  }

  return (
    <BottomSheet
      open={work !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title="课件设置"
    >
      {work && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold">名称</span>
            <Input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="例如：抛物线与动点 P"
              maxLength={40}
            />
          </label>
          <Button className="h-12 w-full" onClick={save} disabled={!canSave}>
            保存名称
          </Button>

          <div className="border-t border-border pt-4">
            {!confirming ? (
              <Button
                variant="ghost"
                className="h-11 w-full text-destructive"
                onClick={() => setConfirming(true)}
              >
                删除课件
              </Button>
            ) : (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-[12px] font-medium text-destructive">删除后无法恢复</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="ghost"
                    className="h-10 flex-1"
                    onClick={() => setConfirming(false)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-10 flex-1"
                    onClick={() => onDelete(work)}
                  >
                    确认删除
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
