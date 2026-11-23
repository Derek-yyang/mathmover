import { useEffect, useState } from 'react';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export type ComposeMode = 'text' | 'modify';

interface ComposeSheetProps {
  mode: ComposeMode | null;
  onClose: () => void;
  onSubmit: (mode: ComposeMode, text: string) => void;
}

const MODIFY_SUGGESTIONS = [
  '把圆的半径改成 3',
  '显示所有顶点的坐标',
  '添加一个动点 P',
  '把图形整体放大 1.5 倍',
];

const TEXT_SUGGESTIONS = [
  '画一个椭圆并标出两个焦点',
  '构造二次函数 y = x² 的图像',
  '用单位圆解释正弦函数',
];

export function ComposeSheet({ mode, onClose, onSubmit }: ComposeSheetProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (mode) setText('');
  }, [mode]);

  const isModify = mode === 'modify';
  const suggestions = isModify ? MODIFY_SUGGESTIONS : TEXT_SUGGESTIONS;

  function submit() {
    const value = text.trim();
    if (!value || !mode) return;
    onSubmit(mode, value);
  }

  return (
    <BottomSheet
      open={mode !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={isModify ? '继续修改' : '输入文字题目'}
    >
      <Textarea
        autoFocus
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={
          isModify
            ? '例如：把圆的半径改成 3，并把圆心标为 O'
            : '例如：画一个椭圆，标出焦点，让动点 P 与两焦点围成三角形。'
        }
      />
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        {suggestions.map(suggestion => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setText(suggestion)}
            className="shrink-0 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground transition active:scale-95"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <Button className="mt-4 h-12 w-full" onClick={submit} disabled={!text.trim()}>
        {isModify ? '发送修改' : '生成图形'}
      </Button>
    </BottomSheet>
  );
}
