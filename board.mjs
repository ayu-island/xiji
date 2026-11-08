#!/usr/bin/env node
// 共享看板 —— 汐记的「第三层记忆」（跨场景总线）
// 灵感来自 BV1H1nU6bEJ5《DSH:一切皆零件》：四层记忆里的共享看板 + 主动换会话。
// 不装任何第三方插件，只用 Node 标准库，数据落在 XIJI_HOME（默认 ~/.xiji）。
//
// 用法:
//   node board.mjs show
//   node board.mjs add <task|note|lesson|decision> "标题" [--detail "…"] [--source "…"]
//   node board.mjs done <id> | drop <id> | reopen <id>
//   node board.mjs handoff      # 换会话前的一张交接单
//   node board.mjs doctor       # 体检：日记 / 看板 / 监听 / 投递的年龄
//   node board.mjs snapshot     # 第四层：把日记和看板归档到今天
import fs from 'node:fs'
import path from 'node:path'
import { filePath, archiveDir } from './lib/config.mjs'

const FILE = filePath('board')
const ARCHIVE = archiveDir()
const KINDS = ['task', 'note', 'lesson', 'decision']
const now = () => new Date().toISOString()

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (!Array.isArray(d.items)) d.items = []
    return d
  } catch { return { version: 1, items: [] } }
}
function save(d) {
  d.version = 1
  d.updatedAt = now()
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2))
  fs.renameSync(tmp, FILE)
}
function newId() { return 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36) }
function age(iso) {
  if (!iso) return '无'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '未知'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
function mtime(p) { try { return fs.statSync(p).mtime.toISOString() } catch { return null } }

const args = process.argv.slice(2)
const cmd = args[0] || 'show'
const opt = {}
const pos = []
for (let i = 1; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true
    opt[k] = v
  } else pos.push(a)
}

if (cmd === 'add') {
  const kind = String(pos[0] || 'task')
  const title = String(pos.slice(1).join(' ') || '').trim()
  if (!KINDS.includes(kind)) { console.error(`kind 只能是 ${KINDS.join(' / ')}`); process.exit(2) }
  if (title.length < 2) { console.error('标题太短'); process.exit(2) }
  const d = load()
  const item = {
    id: newId(), kind, status: 'open', title,
    detail: opt.detail ? String(opt.detail) : '',
    source: opt.source ? String(opt.source) : 'chat',
    createdAt: now(), updatedAt: now(),
  }
  d.items.push(item)
  save(d)
  console.log(`✓ 记下 [${item.id}] (${kind}) ${title}`)
  process.exit(0)
}

if (cmd === 'done' || cmd === 'drop' || cmd === 'reopen') {
  const key = String(pos[0] || '').trim()
  const d = load()
  const it = d.items.find((x) => x.id === key || x.id.startsWith(key))
  if (!it) { console.error(`找不到：${key}`); process.exit(3) }
  it.status = cmd === 'done' ? 'done' : cmd === 'drop' ? 'dropped' : 'open'
  it.updatedAt = now()
  save(d)
  console.log(`✓ ${it.id} → ${it.status}：${it.title}`)
  process.exit(0)
}

if (cmd === 'show') {
  const d = load()
  const open = d.items.filter((x) => x.status === 'open')
  const done = d.items.filter((x) => x.status === 'done')
  console.log(`🧭 共享看板 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  console.log(`待办 ${open.length} · 已完成 ${done.length} · 共 ${d.items.length} 条 · 看板上次更新 ${age(d.updatedAt)}`)
  if (!open.length) console.log('\n（待办是空的 —— 干净）')
  else {
    console.log('\n── 待办 ──')
    for (const x of open) {
      console.log(`  [${x.id}] (${x.kind}) ${x.title}`)
      if (x.detail) console.log(`       ${x.detail}`)
      console.log(`       来源 ${x.source} · ${age(x.updatedAt)}`)
    }
  }
  const recent = done.slice(-3)
  if (recent.length) {
    console.log('\n── 最近完成 ──')
    for (const x of recent) console.log(`  ✓ ${x.title}（${age(x.updatedAt)}）`)
  }
  process.exit(0)
}

if (cmd === 'handoff') {
  const d = load()
  const open = d.items.filter((x) => x.status === 'open')
  const listen = readJson(filePath('listen'))
  const session = readJson(filePath('session'))
  console.log(`# 交接单 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  console.log('')
  console.log('## 待办')
  if (!open.length) console.log('- （空）')
  for (const x of open) console.log(`- [${x.id}] ${x.title}${x.detail ? ` —— ${x.detail}` : ''}`)
  console.log('')
  console.log('## 状态')
  console.log(`- 日记：${age(mtime(filePath('publicDiary')))}更新`)
  console.log(`- 监听游标：${listen?.lastSeen ? new Date(listen.lastSeen * 1000).toLocaleString('zh-CN', { hour12: false }) : '无'}`)
  console.log(`- 上次投递：${session?.deliveredAt ? age(new Date(session.deliveredAt).toISOString()) : '无'}`)
  console.log('')
  console.log('## 下一轮第一件事')
  console.log('1) 读两本日记')
  console.log('2) `node board.mjs show` 看待办')
  console.log('3) 再决定做什么，不假设旧任务已完成')
  process.exit(0)
}

if (cmd === 'doctor') {
  const rows = []
  const push = (name, ok, note) => rows.push({ name, ok, note })
  const diary = filePath('publicDiary')
  const priv = filePath('privateDiary')
  const board = load()
  const dm = mtime(diary)
  push('日记', !!dm && Date.now() - new Date(dm).getTime() < 36 * 3600e3, `${age(dm)}更新`)
  push('私密日记', !!mtime(priv), `${age(mtime(priv))}更新`)
  push('看板', board.items.length > 0, `${board.items.length} 条 · ${age(board.updatedAt)}更新`)
  const listen = readJson(filePath('listen'))
  const lsAge = listen?.lastSeen ? Date.now() - listen.lastSeen * 1000 : NaN
  push('监听游标', Number.isFinite(lsAge), listen?.lastSeen ? `${Math.floor(lsAge / 3600e3)} 小时前的游标（只有新消息才推进）` : '没有')
  const session = readJson(filePath('session'))
  const delAge = session?.deliveredAt ? Date.now() - session.deliveredAt : NaN
  push('会话投递', Number.isFinite(delAge) && delAge < 12 * 3600e3, session?.deliveredAt ? `${age(new Date(session.deliveredAt).toISOString())}投递过` : '没有记录')
  console.log('🩺 看板体检')
  let bad = 0
  for (const r of rows) { if (!r.ok) bad++; console.log(`  ${r.ok ? '✓' : '!'} ${r.name} —— ${r.note}`) }
  console.log(bad ? `\n${bad} 项要留意` : '\n全部正常')
  process.exit(0)
}

if (cmd === 'snapshot') {
  const dir = path.join(ARCHIVE, new Date().toLocaleDateString('sv-SE'))
  fs.mkdirSync(dir, { recursive: true })
  const files = ['publicDiary', 'privateDiary', 'board', 'log'].map((k) => filePath(k)).filter(Boolean)
  const copied = []
  for (const src of files) {
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dir, path.basename(src))); copied.push(path.basename(src)) }
  }
  console.log(`✓ 归档 ${copied.length} 个文件 → ${dir}`)
  process.exit(0)
}

console.log('用法: node board.mjs show | add <task|note|lesson|decision> "标题" [--detail "…"] [--source "…"] | done <id> | drop <id> | handoff | doctor | snapshot')
