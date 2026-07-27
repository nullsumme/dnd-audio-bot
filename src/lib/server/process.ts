import { spawn } from 'node:child_process';

export async function commandAvailable(command: string, args = ['-version']): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 5_000);

    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export function terminateProcess(child: ReturnType<typeof spawn> | null): void {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 1_500);
  timer.unref();
}
