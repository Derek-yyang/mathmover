const fs = require('node:fs');
const path = require('node:path');

/** extraResources 完成复制后再次处理链接，避免打包器或运行时链接残留进入签名阶段。 */
function materializeLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      const temporary = `${file}.materializing`;
      console.log(`[after-pack] 复制运行时链接：${file} -> ${target}`);
      fs.cpSync(target, temporary, { recursive: true, dereference: true, errorOnExist: true, force: false });
      fs.unlinkSync(file);
      fs.renameSync(temporary, file);
    } else if (entry.isDirectory()) materializeLinks(file);
  }
}

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources');
  materializeLinks(resources);
  // Sparkle 的框架和安装助手在 Contents/Frameworks，保留其标准软链接。
  const { adHocSignAfterPack } = await import('electron-sparkle-updater/builder');
  await adHocSignAfterPack(context);
};
module.exports.materializeLinks = materializeLinks;
