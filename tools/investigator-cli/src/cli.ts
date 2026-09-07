#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IncidentBundleSchema } from '@pocketsre/contracts';
import { sanitizeBundle } from '@pocketsre/incident-engine';
import { investigate } from './investigate.js';

function usage(): never {
  console.error('Usage: pocketsre-investigator <incident.json> [--output result.json]');
  process.exit(1);
}

const args = process.argv.slice(2);
const inputPath = args[0];
if (!inputPath) usage();

const outputFlag = args.indexOf('--output');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
if (outputFlag >= 0 && !outputPath) usage();

try {
  const raw = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as unknown;
  const bundle = sanitizeBundle(IncidentBundleSchema.parse(raw));
  const result = investigate(bundle);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (outputPath) {
    await writeFile(resolve(outputPath), serialized, 'utf8');
    console.log(`Investigation result written to ${resolve(outputPath)}`);
  } else {
    process.stdout.write(serialized);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
