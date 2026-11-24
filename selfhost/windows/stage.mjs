import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const stage = path.resolve(process.argv[2]);
const modules = path.join(root, 'node_modules') + path.sep;
const copied = new Set();

async function copyDependency(name, from, optional = false) {
  const resolve = createRequire(path.join(from, 'package.json')).resolve;
  for (const lookup of resolve.paths(name) || []) {
    const directory = path.join(lookup, name);
    if (!directory.startsWith(modules)) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }

    if (copied.has(directory)) return;
    copied.add(directory);
    const target = path.join(stage, path.relative(root, directory));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(directory, target, {
      recursive: true,
      filter: source => source === directory || path.basename(source) !== 'node_modules',
    });
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      if (!(dependency in (manifest.optionalDependencies || {}))) {
        await copyDependency(dependency, directory);
      }
    }
    for (const dependency of Object.keys(manifest.optionalDependencies || {})) {
      await copyDependency(dependency, directory, true);
    }
    return;
  }
  if (!optional) throw new Error(`Missing runtime dependency: ${name} (from ${from})`);
}

for (const name of ['nodemailer', 'sharp', 'zod']) {
  await copyDependency(name, root);
}
