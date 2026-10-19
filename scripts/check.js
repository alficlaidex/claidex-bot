#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set([
  '.git',
  'archives',
  'coverage',
  'logs',
  'node_modules',
  'session',
  'tmp',
])

const files = []

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collect(absolutePath)
      continue
    }
    if (entry.isFile() && ['.cjs', '.js', '.mjs'].includes(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }
}

collect(projectRoot)
files.sort()

const failures = []
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    failures.push({
      file: path.relative(projectRoot, file),
      output: `${result.stdout}${result.stderr}`.trim(),
    })
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n✖ ${failure.file}\n${failure.output}`)
  }
  console.error(`\nSyntax check failed: ${failures.length}/${files.length} file.`)
  process.exit(1)
}

console.log(`Syntax check passed: ${files.length} files.`)
