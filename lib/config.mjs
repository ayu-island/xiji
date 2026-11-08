// 汐记 · 共用路径与配置
//
// 数据放哪：环境变量 XIJI_HOME（默认 ~/.xiji）
// 想换文件名：在 XIJI_HOME 下放一个 xiji.config.json，例如
//   { "files": { "board": "board.json", "cards": "cards.json", "publicDiary": "diary.md" } }
//
// 设计原则：所有路径都在这里算一次，脚本里不出现写死的机器路径。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 数据目录（可用 XIJI_HOME 覆盖） */
export function xijiHome() {
  return process.env.XIJI_HOME || path.join(os.homedir(), '.xiji')
}

/** 确保数据目录存在，返回它 */
export function ensureHome() {
  const h = xijiHome()
  fs.mkdirSync(h, { recursive: true })
  return h
}

const DEFAULTS = {
  board: 'board.json',
  cards: 'cards.json',
  dreams: 'dreams.md',
  publicDiary: 'diary.md',
  privateDiary: 'diary-private.md',
  log: 'log.jsonl',
  listen: 'listen.json',
  session: 'session.json',
  night: 'night.json',
  quota: 'quota.json',
}

/** 读配置（坏了就当空） */
export function loadConfig() {
  const p = path.join(xijiHome(), 'xiji.config.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
}

/** 取一个文件的绝对路径；key 见 DEFAULTS */
export function filePath(key) {
  const cfg = loadConfig()
  const name = (cfg.files && cfg.files[key]) || DEFAULTS[key]
  if (!name) return null
  return path.isAbsolute(name) ? name : path.join(xijiHome(), name)
}

/** 归档目录 */
export function archiveDir() {
  const cfg = loadConfig()
  return path.join(xijiHome(), (cfg.archive && cfg.archive.dir) || 'archive')
}

export const config = { xijiHome, ensureHome, loadConfig, filePath, archiveDir }
