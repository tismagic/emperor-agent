#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const parityPath = join(root, 'docs', 'migration', 'ts', 'PARITY.md')
const parity = readFileSync(parityPath, 'utf8')

const sourceTests = [
  ...parity.matchAll(/\|\s*`(tests\/[^`]+?test_[^`]+?\.py)`\s*\|/g),
]
  .map((match) => match[1])
  .filter(Boolean)
  .sort()
const duplicateSourceTests = duplicates(sourceTests)

const discoveredPythonTests = walk(join(root, 'tests'))
  .filter((path) => /(^|\/)test_[^/]+\.py$/.test(rel(path)))
  .map(rel)
  .sort()

const missingDiscoveredPython = discoveredPythonTests.filter(
  (path) => !sourceTests.includes(path),
)

const mappedTests = [
  ...parity.matchAll(
    /`((?:packages\/core\/src|desktop\/src|desktop-pet\/test)\/[^`]+?\.(?:test\.ts|test\.js))`/g,
  ),
]
  .map((match) => match[1])
  .filter(Boolean)
const missingMapped = [...new Set(mappedTests)]
  .filter((path) => !existsSync(join(root, path)))
  .sort()

if (
  !sourceTests.length ||
  duplicateSourceTests.length ||
  missingDiscoveredPython.length ||
  missingMapped.length
) {
  if (!sourceTests.length) {
    console.error('PARITY.md does not contain a frozen Python test inventory.')
  }
  if (duplicateSourceTests.length) {
    console.error('PARITY.md contains duplicate Python test mappings:')
    for (const path of duplicateSourceTests) console.error(`  - ${path}`)
  }
  if (missingDiscoveredPython.length) {
    console.error('PARITY.md is missing discovered Python test mappings:')
    for (const path of missingDiscoveredPython) console.error(`  - ${path}`)
  }
  if (missingMapped.length) {
    console.error('PARITY.md references missing TS/JS tests:')
    for (const path of missingMapped) console.error(`  - ${path}`)
  }
  process.exit(1)
}

console.log(
  `PARITY.md covers ${sourceTests.length} frozen Python test files and references ${new Set(mappedTests).size} TS/JS test files.`,
)

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (name === '__pycache__') continue
      out.push(...walk(path))
    } else {
      out.push(path)
    }
  }
  return out
}

function rel(path) {
  return path.slice(root.length + 1).replace(/\\/g, '/')
}

function duplicates(values) {
  const seen = new Set()
  const dupes = new Set()
  for (const value of values) {
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes].sort()
}
