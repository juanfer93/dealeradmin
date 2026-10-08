import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const entrypointPath = resolve(directory, '..', 'ghl-collector-normalizer.js');
const modulePaths = [
  '01-runtime-text.js',
  '02-contact-memory.js',
  '03-vehicle.js',
  '04-contact-flow.js',
  '05-qualification-pipeline.js',
].map((fileName) => resolve(directory, 'source', 'modules', fileName));
const source = modulePaths
  .map((modulePath) => readFileSync(modulePath, 'utf8').replace(/\s+$/, ''))
  .join('\n')
  .replace(/\s+$/, '');

if (/\b(?:require|import)\s*\(/.test(source) || /(^|\n)\s*import\s/.test(source)) {
  throw new Error('The GHL Custom Code source must remain standalone and import-free.');
}

const banner = `/*
 * Generated GHL Custom Code entrypoint.
 *
 * Source: domain/ghl-collector-normalizer/source/modules/*.js
 * Build:  node domain/ghl-collector-normalizer/build-entrypoint.mjs
 *
 * Do not edit this artifact by hand. GoHighLevel receives this standalone
 * body and provides inputData at runtime.
 */
`;

writeFileSync(entrypointPath, `${banner}${source}\n`, 'utf8');
