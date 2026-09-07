#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IncidentBundleSchema } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';
import { investigate } from './investigate.js';
import { inspectEnvironmentContract } from './repository.js';

function usage(): never {
  console.error(
    'Usage: pocketsre-investigator <incident.json> [--repo path] [--output result.json]',
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const inputPath = args[0];
if (!inputPath) usage();

const outputFlag = args.indexOf('--output');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
if (outputFlag >= 0 && !outputPath) usage();
const repoFlag = args.indexOf('--repo');
const repository = repoFlag >= 0 ? args[repoFlag + 1] : undefined;
if (repoFlag >= 0 && !repository) usage();
for (let index = 1; index < args.length; index += 2) {
  if (
    !['--repo', '--output'].includes(args[index]!) ||
    !args[index + 1] ||
    args[index + 1]!.startsWith('--')
  )
    usage();
}

try {
  if ((await stat(resolve(inputPath))).size > 2_000_000)
    throw new Error('Incident bundle exceeds 2 MB.');
  const input = await readFile(resolve(inputPath), 'utf8');
  if (Buffer.byteLength(input) > 2_000_000) throw new Error('Incident bundle exceeds 2 MB.');
  const raw = JSON.parse(input) as unknown;
  const bundle = sanitizeBundle(IncidentBundleSchema.parse(raw));
  const result = investigate(bundle);
  if (repository) result.checks.push(await inspectEnvironmentContract(bundle, repository));
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (outputPath) {
    await writeFile(resolve(outputPath), serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(`Investigation result written to ${resolve(outputPath)}`);
  } else {
    process.stdout.write(serialized);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
