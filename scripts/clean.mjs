import { rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
for (const dir of ['coverage', 'reports', '.determinism', '.dumpscan-cache']) {
  rmSync(join(root, dir), { recursive: true, force: true });
}
console.log('cleaned');
