import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./package.py', import.meta.url));
// WindowsApps\python3.exe is a Store alias that exits 9009. The py launcher finds the real install.
const attempts = process.platform === 'win32'
  ? [['py', ['-3', script]]]
  : [['python3', [script]], ['python', [script]]];

for (const [command, args] of attempts) {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  if (result.status === 0) process.exit(0);
  const missing = result.error?.code === 'ENOENT' || result.status === 9009;
  if (!missing) process.exit(result.status ?? 1);
}
console.error('Python 3 が見つかりません。Windows では py ランチャー、それ以外では python3 をインストールしてください。');
process.exit(1);
