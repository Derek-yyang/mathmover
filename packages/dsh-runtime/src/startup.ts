import type { Context } from '@deepseek-ai/cordis';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import { Command } from 'commander';

export const name = 'mathmover-startup';
export const inject = ['cmdlineArgs'];
export const MATHMOVER_STARTUP_SERVICE = 'mathmoverStartup';

export interface MathmoverStartupValues {
  mode: 'models' | 'probe' | 'stdio';
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mathmoverStartup?: MathmoverStartupValues;
  }
}

export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh --profile mathmover')
    .description('Run the MathMover JSONL profile adapter.')
    .helpOption('-h, --help', 'show this help')
    .option('--models', 'print the Harness model catalog and exit')
    .option('--probe', 'print profile compatibility and exit')
    .option('--stdio', 'serve one MathMover run over JSONL stdio')
    .action((options: { models?: boolean; probe?: boolean; stdio?: boolean }) => {
      const modes = [options.models, options.probe, options.stdio].filter(Boolean);
      if (modes.length !== 1) {
        program.error('error: exactly one of --models, --probe, or --stdio is required');
      }
      let mode: MathmoverStartupValues['mode'] = 'stdio';
      if (options.models) mode = 'models';
      else if (options.probe) mode = 'probe';
      ctx.provide(MATHMOVER_STARTUP_SERVICE, { mode });
    });
  parseCmdline(ctx, program);
}
