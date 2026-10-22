import { spawn } from 'node:child_process';

/** 测试必须验证应用确实退出；CDP 断开不等于退出，也不能无限等待继承的管道。 */
export async function closeTestApp(browser, app) {
  let shutdownError;
  if (app.exitCode === null && app.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        shutdownError = new Error('测试应用未在 10 秒内退出');
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true });
        else app.kill('SIGKILL');
        resolve();
      }, 10_000);
      app.once('exit', () => { clearTimeout(timer); resolve(); });
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true });
      else app.kill('SIGTERM');
    });
  }
  app.stdout?.destroy();
  app.stderr?.destroy();
  await Promise.race([
    browser?.close().catch(() => {}),
    new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref(); }),
  ]);
  if (shutdownError) throw shutdownError;
  console.log('PASS: 测试应用已退出');
}
