import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const dir of ['coverage', 'reports', '.determinism', '.dumpscan-cache']) {
  rmSync(join(root, dir), { recursive: true, force: true });
}
console.log('cleaned');
