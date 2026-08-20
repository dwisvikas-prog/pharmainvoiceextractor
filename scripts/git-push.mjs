import { spawnSync } from 'child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const GITHUB_USER = 'dwisvikas-prog';

function git(args, inherit = true) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    const err = result.stderr?.toString().trim();
    if (err) console.error(err);
    process.exit(result.status ?? 1);
  }
  return result.stdout?.toString().trim() || '';
}

const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.status !== 0) {
  console.error(status.stderr);
  process.exit(1);
}

const hasChanges = Boolean(status.stdout.trim());
if (!hasChanges) {
  console.log('Koi naya change nahi hai. Push skip.');
  process.exit(0);
}

console.log('\nGitHub:', `https://github.com/${GITHUB_USER}/pharmainvoiceextractor`);
console.log('\nCurrent changes:\n');
git(['status', '-sb']);

const rl = readline.createInterface({ input, output });
const message = (await rl.question('\nCommit message kya dalna hai? ')).trim();
rl.close();

if (!message) {
  console.log('Message khali hai, cancel.');
  process.exit(1);
}

git(['add', '-A']);
git(['commit', '-m', message]);
git(['push', '-u', 'origin', 'HEAD']);
console.log('\nPush ho gaya', GITHUB_USER, 'wale GitHub pe.');
