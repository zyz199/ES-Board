// 去重：catalog 里如果同时存在「源文本 key」和它的哈希 key（宏真正的 msgid），
// 就把源文本条目的译文并入哈希条目，然后删掉源文本 key。
import fs from 'node:fs'
import { generateMessageId } from '@lingui/message-utils/generateMessageId'

const LOCALES = ['en', 'zh-CN', 'ja']

for (const loc of LOCALES) {
  const file = `src/locales/${loc}/messages.json`
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'))
  const merged = []
  let changed = 0

  for (const key of Object.keys(cat)) {
    const hash = generateMessageId(key)
    if (hash === key) continue
    // key 本身不是哈希、但它的哈希孪生条目存在 → 合并
    if (!(hash in cat)) continue
    const src = cat[key]
    if (src?.translation) cat[hash].translation = src.translation
    delete cat[key]
    merged.push(key)
    changed++
  }
  fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n')
  console.log(`${loc}: 合并 ${changed} 条 ${merged.length ? '→ ' + merged.join(' | ') : ''}`)
}
