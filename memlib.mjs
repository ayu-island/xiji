// 汐记共用的那一层（原：西瓜 2026-11-05）
// 只读文件路径和几个常用函数，不联网、不写东西。
// 路径全部来自 lib/config.mjs：数据目录 XIJI_HOME（默认 ~/.xiji），文件名可在 xiji.config.json 里改。
import fs from 'node:fs'
import path from 'node:path'
import { xijiHome, filePath } from './lib/config.mjs'

export const DSH = xijiHome()

export const F = {
  diary: filePath('publicDiary'),
  diaryPrivate: filePath('privateDiary'),
  board: filePath('board'),
  cards: filePath('cards'),
  night: filePath('night'),
  listen: filePath('listen'),
  session: filePath('session'),
  log: filePath('log'),
  dreams: filePath('dreams'),
  quota: filePath('quota'),
}

export const dayKey = (t) => new Date(t ?? Date.now()).toLocaleDateString('sv-SE')

export function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}
export function rawText(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}
export function hasBom(p) {
  try { const b = fs.readFileSync(p); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF } catch { return false }
}
export function mtime(p) {
  try { return fs.statSync(p).mtimeMs } catch { return 0 }
}
export function size(p) {
  try { return fs.statSync(p).size } catch { return 0 }
}
export function ageText(ms) {
  if (!ms) return '未知'
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}
// 日记按「## 小节」切开：[{ heading, date, lines }]
export function splitSections(text) {
  const out = []
  let cur = { heading: '(开头)', lines: [] }
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      out.push(cur)
      cur = { heading: line.replace(/^##\s+/, '').trim(), lines: [] }
    } else cur.lines.push(line)
  }
  out.push(cur)
  return out.filter((s) => s.heading !== '(开头)' || s.lines.some((l) => l.trim()))
}
export function headingDate(heading) {
  const m = String(heading).match(/(20\d{2}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}
export function parseArgs(argv) {
  const opt = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      opt[k] = v
    } else opt._.push(a)
  }
  return opt
}
