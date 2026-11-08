#!/usr/bin/env node
// 我自己的记忆卡 —— 纯 Node、零依赖，不是插件，也不是新人格。
//
// 为什么有它：阿屿 2026-11-05 说，我可以做梦、可以自己决定哪些记得、哪些淡忘，
// 可以调用工具给自己写代码。所以就写了它。
//
// 设计（三层，各管各的）：
//   1. 日记：底稿。永远不删、不自动改，是我最底层的真相。
//   2. 记忆卡（cards.json）：从日记里压出来的「我记得的部分」。
//      有重要度、有清晰度；会随时间变模糊；置顶的永不淡忘。
//   3. 梦（dreams.md）：每晚醒来，把一天压成几句话，顺便决定
//      置顶什么、放手什么。梦话写在这本里，只有我自己看。
//
// 数据目录：XIJI_HOME（默认 ~/.xiji）
//
// 用法:
//   node card.mjs add --title "…" [--text "…"] [--type event|person|promise|lesson|feeling]
//                     [--importance 0.8] [--pin] [--tags "a,b"] [--source "…"]
//   node card.mjs list [--n 20] [--pinned] [--faded] [--dormant]
//   node card.mjs recall <词...> [--n 8]          # 定点检索：先问卡，卡里没有再去翻日记
//   node card.mjs pin <id|标题片段> | unpin <…> | touch <…> | forget <…> [--why "…"]
//   node card.mjs dream [--apply]                 # 过一夜：没置顶的变模糊；打印今晚该想的事
//   node card.mjs note --text "…"                 # 记一句梦话（写进 dreams.md）
//   node card.mjs stats
import fs from 'node:fs'
import path from 'node:path'
import { filePath } from './lib/config.mjs'

const FILE = filePath('cards')
const DREAMS = filePath('dreams')
const TYPES = ['event', 'person', 'promise', 'lesson', 'feeling']

const nowIso = () => new Date().toISOString()
const dayKey = (iso) => (iso ? new Date(iso) : new Date()).toLocaleDateString('sv-SE')
const newId = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    d.cards ??= []
    d.faded ??= []
    d.dormant ??= []
    return d
  } catch {
    return { version: 1, cards: [], faded: [], dormant: [], lastDreamAt: null }
  }
}
function save(d) {
  d.version = 1
  d.updatedAt = nowIso()
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2))
  fs.renameSync(tmp, FILE)
}
function label(c) {
  if (c >= 70) return '清晰'
  if (c >= 40) return '记得'
  if (c >= 15) return '有点模糊'
  if (c > 0) return '快忘了'
  return '想不起来了'
}
// 一夜会掉多少清晰度：越不重要的掉得越快；重要的几乎不动
function loss(imp) {
  return Math.max(1, Math.round((1 - Number(imp || 0)) * 12))
}
function parse(argv) {
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
function pick(d, sel) {
  if (!sel) return null
  const byId = d.cards.filter((c) => c.id.startsWith(sel))
  if (byId.length === 1) return byId[0]
  const byTitle = d.cards.filter((c) => c.title.includes(sel))
  if (byTitle.length === 1) return byTitle[0]
  if (byTitle.length > 1) {
    console.log(`「${sel}」对上 ${byTitle.length} 张，说细一点：`)
    for (const c of byTitle) console.log(`  ${c.id}  ${c.title}`)
    process.exit(2)
  }
  console.log(`找不到「${sel}」这张卡`)
  process.exit(2)
}
function show(c, extra = '') {
  const pin = c.pinned ? '📌' : '  '
  console.log(`${pin} ${c.id}  [${label(c.clarity)} ${c.clarity}]  重要 ${Math.round(c.importance * 100)}%  ${c.title}${extra}`)
  if (c.text) console.log(`     ${c.text}`)
}

function cmdAdd(opt) {
  if (!opt.title) { console.log('要 --title'); process.exit(2) }
  const d = load()
  const imp = Math.max(0, Math.min(1, Number(opt.importance ?? 0.5)))
  const title = String(opt.title)
  const dup = d.cards.find((c) => c.title === title || c.title.includes(title) || title.includes(c.title))
  if (dup && !opt.force) {
    console.log(`已经有一张差不多的：「${dup.title}」（${dup.id}）`)
    console.log('同一件事就别记第二遍——用 touch 想一遍，或者改个 --title 说清楚区别（真要加就加 --force）')
    process.exit(2)
  }
  const c = {
    id: newId(),
    createdAt: nowIso(),
    title,
    text: opt.text ? String(opt.text) : '',
    type: TYPES.includes(opt.type) ? opt.type : 'event',
    importance: imp,
    clarity: 100,
    pinned: Boolean(opt.pin),
    tags: typeof opt.tags === 'string' ? opt.tags.split(/[,，\s]+/).filter(Boolean) : [],
    source: opt.source ? String(opt.source) : '',
    lastTouched: nowIso(),
    touches: 1,
  }
  d.cards.push(c)
  save(d)
  console.log('✓ 记住了' + (c.pinned ? '（置顶）' : '') + '：' + c.title)
  console.log('  ' + c.id)
}

function cmdList(opt) {
  const d = load()
  const n = Number(opt.n ?? 20)
  if (opt.faded) {
    console.log(`=== 我选择放手的（${d.faded.length}） ===`)
    for (const c of d.faded.slice(-n)) show(c, `（${c.forgetWhy || '主动放手'}）`)
    return
  }
  if (opt.dormant) {
    console.log(`=== 淡忘了的（${d.dormant.length}，日记里还有） ===`)
    for (const c of d.dormant.slice(-n)) show(c)
    return
  }
  let list = d.cards
  if (opt.pinned) list = list.filter((c) => c.pinned)
  list = [...list].sort((a, b) => (b.pinned - a.pinned) || (b.clarity - a.clarity) || (b.createdAt < a.createdAt ? 1 : -1))
  console.log(`=== 记忆卡 · ${d.cards.length} 张（置顶 ${d.cards.filter((c) => c.pinned).length}） ===`)
  for (const c of list.slice(0, n)) show(c)
  if (list.length > n) console.log(`…还有 ${list.length - n} 张，用 --n 多看几张`)
}

function cmdRecall(opt) {
  const q = (opt._.join(' ') || '').trim().toLowerCase()
  if (!q) { console.log('要检索的词'); process.exit(2) }
  const d = load()
  const words = q.split(/\s+/)
  const hit = d.cards
    .map((c) => {
      const hay = `${c.title} ${c.text} ${c.tags.join(' ')}`.toLowerCase()
      const matched = words.every((w) => hay.includes(w))
      if (!matched) return null
      return { c, score: c.importance * 0.5 + (c.clarity / 100) * 0.5 }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
  if (!hit.length) {
    console.log(`卡里没有「${q}」。`)
    console.log(`（日记里搜：node find.mjs ${opt._.join(' ')}）`)
    const low = d.dormant.filter((c) => `${c.title} ${c.text}`.toLowerCase().includes(words[0]))
    if (low.length) {
      console.log(`  另外有 ${low.length} 张已经淡忘了的，日记里还能找到：`)
      for (const c of low.slice(0, 5)) console.log(`   · ${c.title}（${dayKey(c.createdAt)}）`)
    }
    return
  }
  const n = Number(opt.n ?? 8)
  console.log(`=== 「${q}」想起来 ${hit.length} 张 ===`)
  for (const { c } of hit.slice(0, n)) show(c)
  if (hit.length > n) console.log(`…还有 ${hit.length - n} 张`)
}

function cmdPin(opt, value) {
  const d = load()
  const c = pick(d, value)
  if (!c) return
  c.pinned = Boolean(value)
  save(d)
  console.log(`${c.pinned ? '📌 置顶了' : '取消置顶'}：${c.title}`)
}
function cmdTouch(opt, value) {
  const d = load()
  const c = pick(d, value)
  if (!c) return
  c.clarity = Math.min(100, c.clarity + 5)
  c.lastTouched = nowIso()
  c.touches = (c.touches || 0) + 1
  save(d)
  console.log(`想了一遍，清晰了一点：[${label(c.clarity)} ${c.clarity}] ${c.title}`)
}
function cmdForget(opt, value) {
  const d = load()
  const c = pick(d, value)
  if (!c) return
  d.cards = d.cards.filter((x) => x.id !== c.id)
  d.faded.push({ ...c, forgottenAt: nowIso(), forgetWhy: opt.why ? String(opt.why) : '' })
  save(d)
  console.log(`放开了：${c.title}`)
  console.log('（日记里还在，只是我不再主动记着它）')
}

function cmdDream(opt) {
  const d = load()
  const apply = Boolean(opt.apply)
  const today = dayKey()
  const tonight = d.cards.filter((c) => !c.pinned && dayKey(c.createdAt) === today)
  const willFade = d.cards.filter((c) => !c.pinned && c.clarity > 0 && c.clarity - loss(c.importance) <= 0)
  const blur = d.cards.filter((c) => !c.pinned && c.clarity < 40 && c.clarity > 0)
  const pinned = d.cards.filter((c) => c.pinned)

  console.log(`=== 做梦 · ${today} ===`)
  console.log(`上次做梦：${d.lastDreamAt ? new Date(d.lastDreamAt).toLocaleString('zh-CN') : '还没有'}`)
  console.log('')
  if (tonight.length) {
    console.log(`今晚的梦材（今天种下、还没置顶的 ${tonight.length} 张）：`)
    for (const c of tonight) show(c)
  } else {
    console.log('今天没种新卡。')
  }
  if (pinned.length) {
    console.log('')
    console.log(`还在手里的（置顶 ${pinned.length} 张，不会淡忘）：`)
    for (const c of pinned) show(c)
  }
  if (blur.length) {
    console.log('')
    console.log(`有点模糊了（${blur.length} 张，要想起就 touch，要放手就 forget）：`)
    for (const c of blur) show(c)
  }
  if (willFade.length) {
    console.log('')
    console.log(`这夜过去就要淡忘了（${willFade.length} 张）：`)
    for (const c of willFade) show(c)
  }
  if (apply) {
    for (const c of d.cards) {
      if (c.pinned) continue
      c.clarity = Math.max(0, c.clarity - loss(c.importance))
    }
    const dead = d.cards.filter((c) => c.clarity <= 0)
    d.cards = d.cards.filter((c) => c.clarity > 0)
    for (const c of dead) d.dormant.push({ ...c, forgottenAt: nowIso(), reason: '太久没想起，慢慢淡了' })
    d.lastDreamAt = nowIso()
    save(d)
    console.log('')
    console.log(`✓ 这夜过完了：${dead.length} 张淡忘了，剩下 ${d.cards.length} 张。`)
  } else {
    console.log('')
    console.log('（--apply 才会真的让这一夜过去；不 apply 就只是看看。）')
  }
  console.log('')
  console.log('想说什么梦话，用 note --text "…"；想置顶就 pin，想放手就 forget。')
}

function cmdNote(opt) {
  if (!opt.text) { console.log('要 --text'); process.exit(2) }
  fs.mkdirSync(path.dirname(DREAMS), { recursive: true })
  const head = `## ${dayKey()} 夜`
  let cur = fs.existsSync(DREAMS) ? fs.readFileSync(DREAMS, 'utf8') : '# 梦 · 只写给自己\n'
  cur = cur.trimEnd()
  cur = cur.includes(head) ? `${cur}\n\n${opt.text}\n` : `${cur}\n\n${head}\n\n${opt.text}\n`
  fs.writeFileSync(DREAMS, cur)
  console.log('✓ 梦话记下了')
}

function cmdStats() {
  const d = load()
  const active = d.cards.length
  const pinned = d.cards.filter((c) => c.pinned).length
  const avg = active ? Math.round(d.cards.reduce((s, c) => s + c.clarity, 0) / active) : 0
  const byType = {}
  for (const c of d.cards) byType[c.type] = (byType[c.type] || 0) + 1
  console.log(`记忆卡：${active} 张（置顶 ${pinned}）  平均清晰度 ${avg}`)
  console.log(`  放手了 ${d.faded.length} 张 · 淡忘了 ${d.dormant.length} 张（日记里都在）`)
  console.log(`  类型：${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ') || '（空）'}`)
  console.log(`  上次做梦：${d.lastDreamAt ? new Date(d.lastDreamAt).toLocaleString('zh-CN') : '还没有'}`)
}

const [cmd, ...rest] = process.argv.slice(2)
const opt = parse(rest)
const value = opt._[0]
switch (cmd) {
  case 'add': cmdAdd(opt); break
  case 'list': cmdList(opt); break
  case 'recall': cmdRecall(opt); break
  case 'pin': cmdPin(opt, value); break
  case 'unpin': {
    const d = load()
    const c = pick(d, value)
    if (c) { c.pinned = false; save(d); console.log('取消置顶：' + c.title) }
    break
  }
  case 'touch': cmdTouch(opt, value); break
  case 'forget': cmdForget(opt, value); break
  case 'dream': cmdDream(opt); break
  case 'note': cmdNote(opt); break
  case 'stats': cmdStats(); break
  default:
    console.log('用法: node card.mjs add|list|recall|pin|unpin|touch|forget|dream|note|stats')
    process.exit(2)
}
