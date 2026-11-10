import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = process.cwd();
const source = resolve(root, 'data');
const target = resolve(root, 'public', 'data');
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
const index = {};
for (const store of ['equestrian', 'cavali']) {
  const storeDir = join(source, 'archive', store);
  const years = await readdir(storeDir, { withFileTypes: true }).catch(() => []);
  const months = [];
  for (const year of years.filter((entry) => entry.isDirectory())) {
    const files = await readdir(join(storeDir, year.name)).catch(() => []);
    for (const file of files) if (/^\d{4}-\d{2}\.json$/.test(file)) months.push(file.slice(0, 7));
  }
  index[store] = [...new Set(months)].sort().reverse();
}
await writeFile(join(target, 'archive-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log('Cloudflare Pages data assets prepared:', JSON.stringify(index));
