import { describe, it, expect } from 'vitest'

import { parseTopics, matchTopics, PRESET_TOPICS } from '../src/lib/topics'

describe('parseTopics', () => {
  it('提取多个话题，去#、trim、保序', () => {
    expect(parseTopics('今天 #校园社交 聊聊 #LiLink')).toEqual(['校园社交', 'LiLink'])
  })
  it('相邻 # 互相分隔', () => {
    expect(parseTopics('#a#b')).toEqual(['a', 'b'])
  })
  it('中文标点终止话题', () => {
    expect(parseTopics('#校园社交，很棒。#大学生活')).toEqual(['校园社交', '大学生活'])
  })
  it('去重', () => {
    expect(parseTopics('#x 和 #x')).toEqual(['x'])
  })
  it('无话题返回空', () => {
    expect(parseTopics('纯文案没有标签')).toEqual([])
  })
})

describe('matchTopics', () => {
  it('按前缀(包含)过滤候选', () => {
    expect(matchTopics('校园', ['校园社交', '大学生活', '校园日常'])).toEqual(['校园社交', '校园日常'])
  })
  it('空前缀返回去重后的池(截断到 limit)', () => {
    expect(matchTopics('', ['a', 'a', 'b'], 2)).toEqual(['a', 'b'])
  })
})

describe('PRESET_TOPICS', () => {
  it('含固定运营话题', () => {
    expect(PRESET_TOPICS).toContain('LiLink')
    expect(PRESET_TOPICS).toContain('校园社交')
  })
})
