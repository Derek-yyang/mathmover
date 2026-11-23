import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function sharePng(base64: string, filename = 'mathmover.png') {
  if (!Capacitor.isNativePlatform()) {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${base64}`;
    link.download = filename;
    link.click();
    return;
  }

  const file = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    title: 'MathMover 图形',
    text: '由 MathMover 生成',
    url: file.uri,
    dialogTitle: '分享 MathMover 图形',
  });
}
