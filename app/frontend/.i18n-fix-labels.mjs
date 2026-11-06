// 把 App.jsx 菜单标签的 i18n._('X') 改成 t`X` 宏，使其与 catalog 的哈希 id 对齐。
import fs from 'node:fs'

const p = 'src/App.jsx'
let s = fs.readFileSync(p, 'utf8')
const before = s

s = s.replace(/i18n\._\('([^']+)'\)/g, (_m, text) => `t\`${text}\``)
s = s.replace('const { i18n } = useLingui()', 'const { t } = useLingui()')

if (s === before) {
  console.error('未发生替换，请检查文件')
  process.exit(1)
}
fs.writeFileSync(p, s)
console.log('替换 i18n._ 次数：', (before.match(/i18n\._\(/g) || []).length)
