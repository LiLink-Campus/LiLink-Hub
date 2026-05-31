// 三平台创作者后台的选择器与流程常量（集中一处，便于评审与「平台改版漂移」维护）。
//
// 来源标注约定：
//   [SAU]  = dreammis/social-auto-upload（Python+Playwright，~12k star，事实标准）
//            douyin: uploader/douyin_uploader/main.py
//            xhs:    uploader/xhs_uploader/main.py
//            视频号:  uploader/tencent_uploader/main.py
//   [flyer]= flyerhzm/douyin-mcp（Node+Playwright，最贴近本实现的 JS 范式）
//   [matrix]= kebenxiaoming/matrix（Python，独立第二实现，交叉验证抖音）
//   [obs]  = 真实页面观察 / 社区多篇博客共识
//   [infer]= 推测（标注以提示可信度较低、最需真机校验）
//
// 稳健策略（贯穿）：优先对通用 input[type=file] 直接 setInputFiles；标题/正文用
// placeholder/role/文本锚点而非随机 hash class；候选数组按可信度排序，uploader 用
// firstPresent 取第一个真实存在的。选择器整体可信度：medium —— 真机务必复核。

import type { PublishMode } from '../../platforms/registry'

export interface PlatformSelectors {
  /** 发布页 URL（按形态可不同）。 */
  publishUrl: (mode: PublishMode) => string
  /** 任一可见即判「未登录」（被弹回登录页 / 出现二维码）。 */
  loginMarkers: string[]
  /** 视频/单文件上传的 file input 候选（按可信度排序）。 */
  fileInput: string[]
  /** 图文多图上传的 file input 候选。 */
  imageFileInput: string[]
  /** 任一可见即判「素材上传/转码完成」。 */
  uploadComplete: string[]
  /** 标题输入框候选。 */
  titleInput: string[]
  /** 正文/描述 contenteditable 候选（键盘输入，含话题联想）。 */
  bodyEditor: string[]
  /**
   * 话题输入方式：
   * - 'space'：键盘输入「#词」后按空格触发/确认（抖音、视频号）。
   * - 'dropdown'：输入「#词」后等联想下拉、点第一项才成结构化话题（小红书）。
   *   注：纯贴「#文本」不会变真话题，必须按各平台方式触发。
   */
  tagMode: 'space' | 'dropdown'
  /** dropdown 模式下联想下拉第一项的选择器。 */
  topicDropdownItem?: string
  /** 发布按钮：优先 role+name，css 兜底。 */
  publishButton: { role: string; name: string; exact: boolean; cssFallback: string[] }
  /** 发布成功后应跳转到的 URL（glob，waitForURL 用）。 */
  successUrlGlob: string
  /** 切到「图文」形态的 tab（视频号/抖音同入口不同 tab 时用）。 */
  imageNoteTab?: string
  /** 上传素材后页面会跳到的「发布页」URL（抖音 v1/v2）；填字段前先等它。无则上传与填字段同页。 */
  afterUploadUrl?: string | RegExp
}

// ============================ 抖音 douyin ============================
// creator.douyin.com/creator-micro/content/upload
// 标题=短标题 input(≤30)；正文/话题=.zone-container[contenteditable]（键盘输入触发 # 联想）。
export const DOUYIN: PlatformSelectors = {
  publishUrl: () => 'https://creator.douyin.com/creator-micro/content/upload', // [SAU][matrix]
  loginMarkers: ['text=扫码登录', 'text=手机号登录', 'text=二维码失效'], // [SAU] cookie_auth 失效判据
  fileInput: ['input[type=file]'], // [flyer] 通用 file input 最稳；[SAU] div[class^=container] input
  imageFileInput: ['input[accept*="image" i]', 'input[type=file]'], // [SAU] DouYinNote
  uploadComplete: [
    '[class^="long-card"] div:has-text("重新上传")', // [SAU] 出现「重新上传」=上传完成
    'div:has-text("重新上传")', // [matrix] 兜底
  ],
  titleInput: [
    'input[placeholder*="标题"]', // [flyer] 最稳
    'input[placeholder*="作品"]', // [infer] 部分版本
    '.zone-container input[type="text"]', // [SAU] 作品描述区内的 text input
  ],
  bodyEditor: [
    '.zone-container[contenteditable="true"]', // [SAU][matrix]
    'div[contenteditable="true"]', // 兜底
  ],
  tagMode: 'space', // [SAU] keyboard ' #'+tag 后 Space 触发联想
  publishButton: {
    role: 'button',
    name: '发布',
    exact: true, // [SAU][matrix] get_by_role(button,name=发布,exact) 避免点到「发布设置」
    cssFallback: ['button:has-text("发布")'], // [flyer] 兜底
  },
  successUrlGlob: '**/creator-micro/content/manage**', // [SAU][matrix] 跳作品管理=成功
  imageNoteTab: 'text=发布图文', // [SAU] DouYinNote
  // [SAU][matrix] 上传后跳发布页：v1 content/publish?... 或 v2 content/post/video?...；
  // 图文是 content/post/image。正则容三者，避免图文卡在等跳转。
  afterUploadUrl: /content\/(publish|post\/(video|image))/,
}

// ============================ 小红书 xiaohongshu ============================
// creator.xiaohongshu.com/publish/publish（图文默认 tab；视频带 target=video）
// 标题 input.d-text(≤20)；正文 div[contenteditable]；图≤18。
export const XIAOHONGSHU: PlatformSelectors = {
  // [SAU][xpzouying] target=image/video 直达对应形态最稳（绕过 tab 切换）
  publishUrl: (mode) =>
    mode === 'video'
      ? 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video'
      : 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
  loginMarkers: ['text=扫码登录', 'text=立即登录', 'div[class*="login-box"]'], // [SAU][xpzouying] 弹回登录/登录框
  fileInput: [
    'div[class^="upload-content"] input[class="upload-input"]', // [SAU][xpzouying]
    'input[type=file]', // 通用兜底
  ],
  imageFileInput: [
    'input[type="file"][accept*="image" i]', // [SAU]
    'div[class^="upload-content"] input[class="upload-input"]',
    'input[type=file]',
  ],
  uploadComplete: [
    'text=上传成功', // [SAU][xpzouying] 预览区关键词
    'text=重新上传',
    'text=编辑封面',
  ],
  titleInput: [
    'input[placeholder*="填写标题"]', // [xpzouying] 完整 placeholder「填写标题会有更多赞哦」，子串最稳
    'input.d-text', // [SAU] 兜底
    'input[placeholder*="标题"]',
  ],
  bodyEditor: [
    '.ql-editor[contenteditable="true"]', // [xpzouying] 真实 Quill 编辑器优先
    '.ql-editor', // [xpzouying] 兜底
    'p[data-placeholder*="输入正文描述"]', // [SAU] 部分版本的可编辑段
    'div[contenteditable="true"]', // 兜底
  ],
  tagMode: 'dropdown', // [SAU] 必须输入#词→等联想→点 .item，纯文本不成话题
  topicDropdownItem: '#creator-editor-topic-container .item', // [SAU]
  publishButton: {
    role: 'button',
    name: '发布',
    exact: false, // [SAU] button:has-text(发布)
    cssFallback: ['button:has-text("发布")', 'button:has-text("定时发布")'],
  },
  successUrlGlob: '**/publish/success**', // [SAU][xpzouying] 跳成功页
}

// ====================== 微信视频号 weixin_channels ======================
// channels.weixin.qq.com/platform/post/create（即「视频号助手」）
// 短标题 input[placeholder*=概括视频主要内容](≤16，平台即时校验)；描述/话题 .input-editor[contenteditable]；发表。
export const WEIXIN_CHANNELS: PlatformSelectors = {
  // [SAU][registry] 视频走 post/create；图文(动态)走 finderNewLifeCreate
  publishUrl: (mode) =>
    mode === 'image_note'
      ? 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate'
      : 'https://channels.weixin.qq.com/platform/post/create',
  loginMarkers: ['text=扫码登录', 'text=请使用微信扫码', 'iframe[src*="login"]'], // [obs]
  fileInput: ['input[type=file]'], // [SAU] .upload-content 区的 file input
  imageFileInput: ['input[type=file]'],
  uploadComplete: [
    '.delete-btn', // [SAU] 出现删除按钮=上传完成
    'text=重新上传', // [SAU] 兜底
  ],
  titleInput: [
    'input[placeholder*="概括视频主要内容"]', // [SAU] 短标题（≤16）
    'input[placeholder*="标题"]', // 兜底
  ],
  bodyEditor: [
    '.input-editor[contenteditable]', // [SAU] 描述/话题
    'div[contenteditable="true"]', // 兜底
  ],
  tagMode: 'space', // [SAU] keyboard '#'+tag+空格
  publishButton: {
    role: 'button',
    name: '发表', // [SAU] 视频号是「发表」不是「发布」
    exact: true,
    cssFallback: ['button:has-text("发表")'],
  },
  successUrlGlob: '**/platform/post/list**', // [SAU] 跳作品列表=成功
}

import type { ManualPlatformCode } from '../../platforms/registry'

export const SELECTORS: Record<ManualPlatformCode, PlatformSelectors> = {
  douyin: DOUYIN,
  xiaohongshu: XIAOHONGSHU,
  weixin_channels: WEIXIN_CHANNELS,
}
