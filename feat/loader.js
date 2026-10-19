import { readdir } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { logger } from '../core/logger.js'
const FEATURES_DIR = fileURLToPath(new URL('.', import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const byCommand = new Map()



const RELOAD_GENERATION_MOD = 1000
let reloadGeneration = 0
let loadedCount = 0
let lastFailed = []
async function walk(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else if (extname(entry.name) === '.js' && fullPath !== SELF) {
      files.push(fullPath)
    }
  }
  return files
}

function describeImportError(err, filePath) {
  const short = relative(FEATURES_DIR, filePath)
  
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    const missing = err.message.match(/Cannot find (?:package|module) '([^']+)'/)?.[1]
    return `${short} -> modul tidak ditemukan: "${missing || '?'}" (cek path import di file ini)`
  }
  
  if (err instanceof SyntaxError || /Unexpected token|is not defined/i.test(err.message)) {
    const loc = err.stack?.split('\n')[0] ?? ''
    return `${short} -> syntax error: ${err.message} ${loc ? `(${loc})` : ''}`
  }
  
  return `${short} -> ${err.name || 'Error'}: ${err.message}`
}
export async function loadFeatures() {
  
  
  
  const next = new Map()
  let files
  try {
    files = await walk(FEATURES_DIR)
  } catch (err) {
    const reason = `${err?.message || err} (gagal scan folder feat/)`
    logger.error(`Gagal memuat feature — ${reason}`)
    return { count: byCommand.size, total: 0, failed: [{ file: '(scan)', stage: 'walk', reason }], unchanged: true }
  }
  reloadGeneration = (reloadGeneration + 1) % RELOAD_GENERATION_MOD
  const failed = []
  let count = 0
  for (const filePath of files) {
    const short = relative(FEATURES_DIR, filePath)
    let mod
    
    
    
    
    
    try {
      const moduleUrl = `${pathToFileURL(filePath).href}?g=${reloadGeneration}`
      mod = await import(moduleUrl)
    } catch (err) {
      const reason = describeImportError(err, filePath)
      logger.error(`Gagal memuat feature — ${reason}`)
      failed.push({ file: short, stage: 'import', reason })
      continue
    }
    
    const feature = mod.default
    if (!feature?.name || typeof feature.run !== 'function') {
      const missing = [
        !feature ? 'export default kosong/undefined' : null,
        feature && !feature.name ? '`name`' : null,
        feature && typeof feature.run !== 'function' ? '`run()`' : null,
      ].filter(Boolean).join(', ')
      const reason = `${short} -> shape invalid, yang kurang: ${missing}`
      logger.warn(reason)
      failed.push({ file: short, stage: 'validate', reason })
      continue
    }
    
    const keys = [feature.name.toLowerCase(), ...(feature.aliases ?? []).map(a => a.toLowerCase())]
    const clash = keys.find(k => next.has(k) && next.get(k) !== feature)
    if (clash) {
      const owner = next.get(clash)
      const reason = `${short} -> command/alias "${clash}" udah dipakai feature lain (${owner.name})`
      logger.warn(reason)
      failed.push({ file: short, stage: 'conflict', reason })
      continue
    }
    for (const key of keys) next.set(key, feature)
    count += 1
  }
  
  
  byCommand.clear()
  for (const [key, feature] of next) byCommand.set(key, feature)
  loadedCount = count
  lastFailed = failed
  logger.info(`${count} feature dimuat dari ${files.length} file${failed.length ? ` (${failed.length} gagal)` : ''}`)
  if (failed.length) {
    for (const f of failed) logger.error(`  ↳ [${f.stage}] ${f.reason}`)
  }
  return { count, total: files.length, failed }
}
export function getFeature(name) {
  return byCommand.get(name.toLowerCase())
}
export function listFeatures() {
  return [...new Set(byCommand.values())]
}
export function featureCount() {
  return loadedCount
}
export function lastLoadFailures() {
  return lastFailed
}