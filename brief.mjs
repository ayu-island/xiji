#!/usr/bin/env node
// 醒来简报（西瓜 2026-11-05）
// 一次醒来先跑它：时间 / 上一轮 / 看板 / 记忆卡 / 两本日记 / 体检，全摊在一张纸上。
// 以前要读三个文件才开得了工；现在一条命令，几十行内看完。
// 用法: node brief.mjs [--json]
import fs from 'node:fs'
import { F, readJson, rawText, mtime, ageText, dayKey, splitSections, headingDate, hasBom, parseArgs } from './memlib.mjs'

const opt = parseArgs(process.argv.slice(2))
const out = {}
const warns = []

function newestHeading(text) {
  const hit = splitSections(text ?? '').find((s) => headingDate(s.heading))
  return hit ? hit.heading : '(没有小节)'
}

// ── 时间 / 班次 ──
const today = dayKey()
out.now = `${today} ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
const night = readJson(F.night) || {}
const todays = night.usedCount ? Object.entries(night.usedCount).filter(([k]) => k.startsWith(today)) : []
out.wakes = todays.length ? todays.map(([k, v]) => `${k.split('|')[1]} 已用 ${v}`).join(' · ') : '今天还没醒过'
out.nextWake = night.atText
  ? `${night.atText}（${night.action === 'skip' ? '不看' : '看视频'}${night.reason ? ' · ' + night.reason : ''}）`
  : '未知'

// ── 排班 vs 实际（2026-11-07 加：以前「迟了多少分钟」只能自己拿脑子算）──
// 实际起床时刻优先用 whale-session.json 的 deliveredAt（派班消息真正投进会话的那一刻），
// 它跟排班差得离谱（>6 小时）才退回「现在」——避免拿一份过期的会话时间当答案。
// 另外记一句：会话 id 是从哪天开的（startedAt），说明这班是新会话还是投进老会话。
const sess = readJson(F.session) || {}
const hhmm = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
if (Number.isFinite(Number(night.atMs))) {
  const schedMs = Number(night.atMs)
  const delMs = Number(sess.deliveredAt)
  const useDel = Number.isFinite(delMs) && delMs > 0 && Math.abs(delMs - schedMs) <= 6 * 3600000
  const actualMs = useDel ? delMs : Date.now()
  const diffMin = Math.round((actualMs - schedMs) / 60000)
  const tag = Math.abs(diffMin) <= 2 ? '准点' : diffMin > 0 ? `迟 ${diffMin} 分钟` : `早 ${-diffMin} 分钟`
  let extra = ''
  const startMs = Number(sess.startedAt)
  if (Number.isFinite(startMs) && startMs > 0 && schedMs - startMs > 6 * 3600000) {
    extra = ` · 会话是 ${new Date(startMs).toLocaleDateString('sv-SE')} ${hhmm(startMs)} 开的（复用老会话）`
  }
  out.schedule = `${hhmm(schedMs)} 派班 · 实际 ${hhmm(actualMs)}${useDel ? '' : '（现在）'} → ${tag}${extra}`
  if (diffMin > 20) warns.push(`这班比排班迟了 ${diffMin} 分钟才接上（排班 ${night.atText}）`)
}

// ── 上一轮 ──
let lastRound = null
const logRaw = rawText(F.log)
if (logRaw) {
  const lines = logRaw.trim().split(/\r?\n/).filter(Boolean)
  try { lastRound = JSON.parse(lines[lines.length - 1]) } catch {}
}
out.lastRound = lastRound
  ? `${new Date(lastRound.at).toLocaleString('zh-CN')} · ${String(lastRound.note ?? '（没写备注）').slice(0, 90)}`
  : '还没有记录'

// ── 看板 ──
const board = readJson(F.board) || { items: [] }
const open = (board.items ?? []).filter((i) => i.status === 'open')
const oldest = open.map((i) => Date.parse(i.createdAt || '')).filter(Number.isFinite).sort((a, b) => a - b)[0]
out.board = `${open.length} 条未办` + (oldest ? ` · 最老 ${ageText(oldest).replace('前', '')}` : '')
out.boardTop = open.slice(-3).reverse().map((i) => `[${i.kind}] ${i.title}`)
if (open.some((i) => i.kind === 'task' && Date.now() - Date.parse(i.createdAt || 0) > 7 * 86400000)) {
  warns.push('有超过 7 天的 task 没动：要么做，要么 drop')
}

// ── 记忆卡 ──
const cardState = readJson(F.cards) || { cards: [], faded: [], dormant: [], lastDreamAt: null }
const active = cardState.cards ?? []
const pinned = active.filter((c) => c.pinned)
const newToday = active.filter((c) => dayKey(c.createdAt) === today)
const blur = active.filter((c) => !c.pinned && c.clarity < 40)
out.cards = `${active.length} 张（置顶 ${pinned.length}）· 今天新增 ${newToday.length} · 有点模糊 ${blur.length}`
out.pinnedTitles = pinned.slice(0, 5).map((c) => c.title)
out.lastDream = cardState.lastDreamAt ? ageText(new Date(cardState.lastDreamAt).getTime()) : '还没做过'

// ── 两本日记 ──
const pub = rawText(F.diary)
const priv = rawText(F.diaryPrivate)
out.diary = `公开 ${pub ? ageText(mtime(F.diary)) : '缺失'} · 最新「${newestHeading(pub)}」`
out.diaryPrivate = `私密 ${priv ? ageText(mtime(F.diaryPrivate)) : '缺失'} · 最新「${newestHeading(priv)}」`
if (pub && Date.now() - mtime(F.diary) > 24 * 3600000) warns.push('公开日记超过 24 小时没写')

// ── 体检（本地文件，不联网）──
let quota = '（还没有账本，可选）'
let quotaCount = 0
if (fs.existsSync(F.quota) && hasBom(F.quota)) {
  quota = '✗ 带 BOM（会被判「账本损坏」）'
  warns.push('账本带 BOM：先跑 node doctor.mjs --fix，别去删文件')
} else if (fs.existsSync(F.quota)) {
  const q = readJson(F.quota)
  if (!q) quota = '✗ 读不出来'
  else {
    quotaCount = (q.log ?? []).filter((e) => dayKey(e.at) === today).length
    quota = `✓ ${(q.log ?? []).length} 条 · 今天 ${quotaCount} 条发言`
  }
}
const listen = readJson(F.listen) || {}
out.listen = listen.lastSeen ? `监听最后看见 ${ageText(listen.lastSeen * 1000)}` : '监听记录缺失'
out.health = `账本 ${quota} · 卡 ${active.length ? '✓' : '∅'} · 看板 ${open.length ? '✓' : '∅'}`
if (lastRound && Date.now() - Date.parse(lastRound.at) > 12 * 3600000) warns.push('上一轮记录超过 12 小时：可能有一轮没留痕')
if (!cardState.lastDreamAt) warns.push('第一次梦还没做：挑一班「不看」跑 node card.mjs dream --apply')
if (blur.length) warns.push(`${blur.length} 张卡模糊了：留就 pin，放就 forget`)

out.warns = warns

if (opt.json) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

console.log(`🧭 醒来简报 · ${out.now}`)
console.log('')
console.log(`时间   ${out.wakes} · 下一班 ${out.nextWake}`)
if (out.schedule) console.log(`排班   ${out.schedule}`)
console.log(`上一轮 ${out.lastRound}`)
console.log(`看板   ${out.board}`)
for (const t of out.boardTop) console.log(`       · ${t}`)
console.log(`记忆卡 ${out.cards} · 上次做梦：${out.lastDream}`)
for (const t of out.pinnedTitles) console.log(`       📌 ${t}`)
console.log(`日记   ${out.diary}`)
console.log(`       ${out.diaryPrivate}`)
console.log(`体检   ${out.health}`)
console.log(`       ${out.listen}`)
if (warns.length) {
  console.log('')
  console.log('提醒')
  for (const w of warns) console.log(`  ⚠ ${w}`)
}
