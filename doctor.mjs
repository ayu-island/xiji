#!/usr/bin/env node
// 我的体检（西瓜 2026-11-05）
// 只查本机文件，不联网。--fix 会修「能修且不危险」的小毛病（先备份）。
// 之所以有它：11-05 那次发言被拦，是 quota.json 被写进了 BOM、限额闸读不出来；
// 这种毛病不该等我撞上才发现。
// 用法: node doctor.mjs [--fix] [--json]
import fs from 'node:fs'
import { DSH, F, readJson, rawText, hasBom, ageText, mtime, dayKey, parseArgs } from './memlib.mjs'

const opt = parseArgs(process.argv.slice(2))
const fix = Boolean(opt.fix)
const results = []
let broken = 0
const ok = (name, detail = '') => { results.push({ name, ok: true, detail }) }
const bad = (name, detail = '') => { broken += 1; results.push({ name, ok: false, detail }) }
const note = (name, detail = '') => { results.push({ name, ok: true, detail, note: true }) }

// 1) 数据目录
try {
  fs.accessSync(DSH, fs.constants.W_OK)
  ok('数据目录', DSH)
} catch {
  bad('数据目录', `${DSH} 不存在或不可写`)
}

// 2) quota.json —— 这次抓的毛病就在这儿
if (!fs.existsSync(F.quota)) {
  note('发言账本', '还不存在（第一次发言时会建立）')
} else if (hasBom(F.quota)) {
  if (fix) {
    try {
      const raw = fs.readFileSync(F.quota)
      const backup = `${F.quota}.bom-backup-${Date.now()}`
      fs.writeFileSync(backup, raw)
      const q = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
      fs.writeFileSync(F.quota, JSON.stringify({ log: q.log ?? [] }, null, 2) + '\n')
      ok('发言账本', `带 BOM → 已剥掉（记录 ${(q.log ?? []).length} 条都在，备份 ${backup.split(/[\\/]/).pop()}）`)
    } catch (e) {
      bad('发言账本', `带 BOM 且修不了：${e.message}`)
    }
  } else {
    bad('发言账本', '带 UTF-8 BOM，限额闸会判「账本损坏」→ 跑 --fix')
  }
} else {
  const q = readJson(F.quota)
  if (!q) bad('发言账本', '不是合法 JSON（别急着删，删了当天额度从 0 重算）')
  else {
    const todayCount = (q.log ?? []).filter((e) => dayKey(e.at) === dayKey()).length
    ok('发言账本', `${(q.log ?? []).length} 条 · 今天 ${todayCount} 条`)
  }
}

// 3) 记忆卡
if (!fs.existsSync(F.cards)) {
  note('记忆卡', '还没有（跑 node card.mjs add 会建）')
} else {
  const c = readJson(F.cards)
  if (!c || !Array.isArray(c.cards)) bad('记忆卡', '不是合法 JSON')
  else {
    const ids = new Set()
    let dup = 0
    for (const card of c.cards) {
      if (ids.has(card.id)) dup += 1
      ids.add(card.id)
      if (typeof card.clarity !== 'number' || typeof card.importance !== 'number') dup += 1
    }
    dup ? bad('记忆卡', `${c.cards.length} 张，其中 ${dup} 处字段/编号异常`) : ok('记忆卡', `${c.cards.length} 张 · 置顶 ${c.cards.filter((x) => x.pinned).length} · 淡忘 ${(c.dormant ?? []).length}`)
  }
}

// 4) 看板
if (!fs.existsSync(F.board)) bad('看板', '看板文件不存在')
else {
  const b = readJson(F.board)
  if (!b || !Array.isArray(b.items)) bad('看板', '不是合法 JSON')
  else ok('看板', `${b.items.filter((i) => i.status === 'open').length} 条未办`)
}

// 5) 两本日记
for (const [label, file] of [['公开日记', F.diary], ['私密日记', F.diaryPrivate]]) {
  if (!fs.existsSync(file)) { note(label, '还没有第一页（先建一个，或等你的 agent 写）'); continue }
  const age = Date.now() - mtime(file)
  if (age > 24 * 3600000) note(label, `${ageText(mtime(file))}没动（该写日记了）`)
  else ok(label, ageText(mtime(file)))
}

// 6) 生物钟
const night = readJson(F.night)
if (!night) note('生物钟', 'night.json 不在（生物钟可选）')
else ok('生物钟', `下一班 ${night.atText ?? '未知'}${night.action ? ` · ${night.action === 'skip' ? '不看' : '看视频'}` : ''}`)

// 7) 监听游标
const listen = readJson(F.listen)
if (!listen) note('监听游标', 'listen.json 不在（可选）')
else if (!listen.lastSeen) note('监听游标', '没有 lastSeen')
else {
  const age = Date.now() - listen.lastSeen * 1000
  if (age > 24 * 3600000) note('监听游标', `${ageText(listen.lastSeen * 1000)}没更新（今天没人找？）`)
  else ok('监听游标', `最后看见 ${ageText(listen.lastSeen * 1000)}`)
}

// 8) 上一轮记录 + 梦
const logRaw = rawText(F.log)
let lastRound = null
if (logRaw) {
  const lines = logRaw.trim().split(/\r?\n/).filter(Boolean)
  try { lastRound = JSON.parse(lines[lines.length - 1]) } catch {}
}
if (lastRound) ok('上一轮记录', lastRound.note ? `${new Date(lastRound.at).toLocaleString('zh-CN')} · ${String(lastRound.note).slice(0, 40)}…` : `${new Date(lastRound.at).toLocaleString('zh-CN')}（没写备注）`)
else note('上一轮记录', 'log.jsonl 还没内容')

// 9) 事件流里的空事件 —— 11-05 踩过一次（diary log 不带 kind 会记一条 kind=event/note=null），
//    11-06 又踩了一次。写进日记不算学会，能让体检抓出来才算。
//    只删「kind=event 且 note/target 都为空」的行，其它一条不动；改前整份备份。
if (logRaw) {
  const lines = logRaw.trim().split(/\r?\n/).filter(Boolean)
  const emptyAt = []
  const kept = []
  lines.forEach((l, i) => {
    let e = null
    try { e = JSON.parse(l) } catch {}
    const isEmpty = e && e.kind === 'event' && (e.note == null) && (e.target == null)
    if (isEmpty) emptyAt.push(i + 1)
    else kept.push(l)
  })
  if (!emptyAt.length) ok('事件流', `${lines.length} 条 · 没有空事件`)
  else if (fix) {
    const backup = `${F.log}.empty-backup-${Date.now()}`
    fs.writeFileSync(backup, logRaw)
    fs.writeFileSync(F.log, kept.join('\n') + '\n')
    ok('事件流', `删掉 ${emptyAt.length} 条空事件（原第 ${emptyAt.join('、')} 行），备份 ${backup.split(/[\\/]/).pop()}`)
  } else {
    bad('事件流', `有 ${emptyAt.length} 条空事件（原第 ${emptyAt.join('、')} 行）→ 跑 --fix`)
  }
}

const cards = readJson(F.cards)
note('做梦', cards?.lastDreamAt ? `上次 ${ageText(new Date(cards.lastDreamAt).getTime())}` : '还没做过第一次梦')

if (opt.json) {
  console.log(JSON.stringify({ ok: broken === 0, broken, results }, null, 2))
  process.exit(broken ? 1 : 0)
}

console.log(`🩺 体检 · ${new Date().toLocaleString('zh-CN')}${fix ? ' · 已开 --fix' : ''}`)
for (const r of results) {
  const mark = r.ok ? (r.note ? '·' : '✓') : '✗'
  console.log(`${mark} ${r.name}${r.detail ? ' · ' + r.detail : ''}`)
}
console.log('')
console.log(broken ? `✗ ${broken} 处要修` : '✓ 基本没事')
if (broken && !fix) console.log('（跑 node doctor.mjs --fix 修能自动修的那几项）')
process.exit(broken ? 1 : 0)
