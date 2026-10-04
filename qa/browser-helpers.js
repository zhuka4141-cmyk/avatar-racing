'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const pagePath = path.join(repoRoot, 'index.html');
const outputDir = path.resolve(process.env.QA_OUT || path.join(repoRoot, 'qa'));

function getChromium() {
  const moduleName = process.env.PW_PATH || 'playwright-core';
  try {
    return require(moduleName).chromium;
  } catch (error) {
    const hint = process.env.PW_PATH
      ? `PW_PATH does not point to a usable playwright-core package: ${process.env.PW_PATH}`
      : 'Set PW_PATH to a playwright-core installation or install playwright-core in the project.';
    error.message = `${hint}\n${error.message}`;
    throw error;
  }
}

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function outputPath(name) {
  ensureOutputDir();
  return path.join(outputDir, name);
}

async function makeBrowser(options) {
  return getChromium().launch(options || {});
}

function assertNoPageErrors(errors) {
  if (errors && errors.length) {
    throw new Error(`Browser page errors:\n${errors.join('\n')}`);
  }
}

function writeScreenshot(page, name, options) {
  return page.screenshot(Object.assign({ path: outputPath(name) }, options || {}));
}

module.exports = {
  repoRoot,
  pagePath,
  pageUrl: `${pathToFileURL(pagePath).href}?test=1`,
  outputDir,
  outputPath,
  ensureOutputDir,
  getChromium,
  makeBrowser,
  assertNoPageErrors,
  writeScreenshot
};
