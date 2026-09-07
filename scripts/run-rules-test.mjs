import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const javaHomes = [
  '/opt/homebrew/opt/openjdk@21',
  '/usr/local/opt/openjdk@21',
  process.env.JAVA_HOME,
].filter(Boolean);
const javaHome = javaHomes.find((candidate) => existsSync(join(candidate, 'bin', 'java')));
const environment = { ...process.env };
if (javaHome) {
  environment.JAVA_HOME = javaHome;
  environment.PATH = `${join(javaHome, 'bin')}${delimiter}${environment.PATH || ''}`;
}

const result = spawnSync(
  'firebase',
  ['emulators:exec', '--only', 'firestore', 'node scripts/verify-rules.mjs'],
  { cwd: new URL('..', import.meta.url), env: environment, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
