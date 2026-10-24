/**
 * 更新模块的持久化日志。
 *
 * 从 Finder 启动的桌面应用没有终端接着 stdout，`console.log` 里的 Sparkle /
 * electron-updater 报错会直接丢失。这里把更新相关的事件追加到数据目录的
 * `logs/updater.log`，出问题时能从「打开日志目录」直接看到原文。
 *
 * 只记录 URL、版本号、错误域等信息，不写密钥或课件数据。
 */
const fs = require('node:fs');
const path = require('node:path');

function serialize(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLine(args, date) {
  return `[${date.toISOString()}] ${args.map(serialize).join(' ')}`;
}

function createUpdateLog(filePath, { maxBytes = 1024 * 1024, now = () => new Date() } = {}) {
  return function updateLog(...args) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      try {
        if (fs.statSync(filePath).size > maxBytes) {
          const rotated = `${filePath}.1`;
          fs.rmSync(rotated, { force: true });
          fs.renameSync(filePath, rotated);
        }
      } catch { /* 文件还不存在或被杀软占用：继续追加 */ }
      fs.appendFileSync(filePath, `${formatLine(args, now())}\n`);
    } catch { /* 日志失败不能影响更新流程 */ }
  };
}

module.exports = { createUpdateLog, formatLine };
