// 图文话题工具：从正文纯文本解析 #话题、提供联想词库与前缀匹配。
// 纯函数，无副作用，client/server 通用（不要加 'use client'/'use server'）。

/** 预设话题（不带 #）：固定运营话题 + 常用校园话题，作为联想候选基底。 */
export const PRESET_TOPICS: string[] = [
  'LiLink', '校园社交', '大学生活', '校园日常', '大学生', '社团活动',
  '校园活动', '搭子', '宿舍生活', '开学季', '期末季', '校园美食',
]

// #话题边界：到空白 / 另一个# / 常见中英文标点为止。
const TOPIC_RE = /#([^\s#,，。、!！?？;；:：~（）()【】"'\n\r\t]+)/g

/** 从正文提取话题（不带#、trim、去重、保序）。 */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(TOPIC_RE)) {
    const tag = m[1].trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/** 前缀匹配候选（不带#、去重、截断到 limit）。空前缀=返回去重池。 */
export function matchTopics(prefix: string, pool: string[], limit = 8): string[] {
  const q = prefix.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of pool) {
    if (!t || seen.has(t)) continue
    if (!q || t.toLowerCase().includes(q)) {
      seen.add(t)
      out.push(t)
      if (out.length >= limit) break
    }
  }
  return out
}
