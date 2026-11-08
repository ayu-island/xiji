#!/usr/bin/env node
// 日记定点检索（西瓜 2026-11-05）
// 两本日记是底稿；以前要找一句话只能从头翻，现在按小节查、报日期和原句。
// 用法: node find.mjs <词...> [--days 30] [--n 12] [--book both|public|private] [--lines 2]
import { F, rawText, splitSections, headingDate, parseArgs } from './memlib.mjs'

const opt = parseArgs(process.argv.slice(2))
const words = (opt._.join(' ') || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
if (!words.length) {
  console.log('用法: node find.mjs <词...> [--days 30] [--n 12] [--book both|public|private]')
  process.exit(2)
}
const days = Number(opt.days ?? 0)
const limit = Number(opt.n ?? 12)
const maxLines = Number(opt.lines ?? 2)
const books = opt.book === 'public' ? ['public'] : opt.book === 'private' ? ['private'] : ['public', 'private']

const todayMs = Date.now()
const hits = []
for (const book of books) {
  const file = book === 'public' ? F.diary : F.diaryPrivate
  const text = rawText(file)
  if (!text) continue
  for (const sec of splitSections(text)) {
    const hay = (`${sec.heading}\n${sec.lines.join('\n')}`).toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const date = headingDate(sec.heading)
    if (days && date) {
      const d = Date.parse(`${date}T00:00:00`)
      if (Number.isFinite(d) && todayMs - d > days * 86400000) continue
    }
    const matched = sec.lines
      .map((line, i) => ({ i, line: line.trim() }))
      .filter(({ line }) => words.some((w) => line.toLowerCase().includes(w)))
    hits.push({ book, heading: sec.heading, date, matched })
  }
}
hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))

if (!hits.length) {
  console.log(`日记里没有「${words.join(' ')}」。`)
  console.log(`（试试更宽的词，或者用 node card.mjs recall ${words.join(' ')} 搜记忆卡）`)
  process.exit(0)
}
const shown = hits.slice(0, limit)
console.log(`=== 「${words.join(' ')}」命中 ${hits.length} 个小节（${books.join(' · ')}） ===`)
for (const h of shown) {
  console.log('')
  const clean = h.heading.replace(/^20\d{2}-\d{2}-\d{2}\s*[·:：|–-]?\s*/, '')
  console.log(`📖 ${h.book === 'public' ? '公开' : '私密'} · ${h.date || '?'} · ${clean}`)
  for (const m of h.matched.slice(0, maxLines)) console.log(`   · ${m.line}`)
  if (h.matched.length > maxLines) console.log(`   …这个小节还有 ${h.matched.length - maxLines} 行提到`)
}
if (hits.length > shown.length) console.log(`\n…还有 ${hits.length - shown.length} 个小节，用 --n 多看几个`)
