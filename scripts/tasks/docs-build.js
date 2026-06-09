#!/usr/bin/env node
import { runDocsBuild } from '../../website/build.js';

const checkOnly = process.argv.includes('--check');

runDocsBuild(process.argv.slice(2)).then((result) => {
  if (checkOnly) {
    console.log(`Docs build check passed (${result.pages} guide pages, ${result.advanced} advanced pages, ${result.examples ?? 1} examples page).`);
    return;
  }
  console.log(`Built docs site to ${result.outDir} (${result.pages} guide pages, ${result.advanced} advanced pages, ${result.examples ?? 1} examples page).`);
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
