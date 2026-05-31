/* eslint-disable no-console */
// LiLink 浏览器自动化发布 worker（独立 CLI，跑在运营本机/VPS 持登录态）。
//
// 跑法（在 platform 目录）：
//   set -a; source .env; set +a            # export 命令需要 DATABASE_URI 等
//   npx tsx scripts/publish-worker.ts <command> [flags]
//
// 命令：
//   doctor  [--platform p]                          自检：Chrome 可启动、目录可写
//   login   --platform <p>                          有头打开发布页，扫码登录（持久化 profile）
//   export  --content-id <id> --out <job.json>      从中台稿件导出 worker 可消费的 job JSON
//   run     (--job f | --package f | --stdin) [...] 执行发布
//           [--headed] [--draft|--publish] [--fill-only] [--slow-mo ms] [--dry-run]
//   logout  --platform <p>                          清除该平台登录态
//
// 安全默认：run 不带 --publish 即为 draft（只填好不点最终发布；headed 下保留浏览器交人工点发布）。
// --publish 会二次确认。session profile 存 ~/.lilink/publish-sessions（等同账号凭据，勿提交/外传）。

import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { isManualPlatform, type ManualPlatformCode } from '../src/platforms/registry'
import { buildBrowserJob, type BrowserPublishJob } from '../src/automation/job'
import type { SocialPublishPackage } from '../src/renderers/social-package'
import { runBrowserPublish } from '../src/automation/run'
import { launchSession, clearSession, sessionDir } from '../src/automation/session'
import { getUploader } from '../src/automation/uploaders'
import { reportResult, type BrowserPublishResult } from '../src/automation/report'

function nowIso(): string {
  return new Date().toISOString()
}
// 错误信息脱敏：去掉可能的 query 串（防 presigned 签名等泄漏进回报/日志）。
function redactErr(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\?[^\s)]+/g, '?…')
}
// 按需回报结果到中台（缺 content-id / env 时只 warn 跳过，绝不影响发布）。
async function maybeReport(
  doReport: boolean,
  contentId: string | undefined,
  result: BrowserPublishResult,
): Promise<void> {
  if (!doReport) return
  if (!contentId) {
    log('⚠ --report 但无 content-id，跳过回报')
    return
  }
  const studioUrl = process.env.LILINK_STUDIO_URL
  const token = process.env.WORKER_REPORT_TOKEN
  if (!studioUrl || !token) {
    log('⚠ --report 但缺 LILINK_STUDIO_URL / WORKER_REPORT_TOKEN，跳过回报')
    return
  }
  await reportResult({ studioUrl, token, contentId, result, log })
}

function log(msg: string): void {
  console.log(`[worker] ${msg}`)
}
function die(msg: string): never {
  console.error(`[worker] 错误：${msg}`)
  process.exit(1)
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

function requirePlatform(v: unknown): ManualPlatformCode {
  if (!isManualPlatform(v)) {
    die(`--platform 必须是 weixin_channels | xiaohongshu | douyin，收到：${String(v)}`)
  }
  return v
}

// ---------------- doctor ----------------
async function doctor(platform?: ManualPlatformCode): Promise<void> {
  log('自检开始')
  const targets: ManualPlatformCode[] = platform ? [platform] : ['douyin', 'xiaohongshu', 'weixin_channels']
  let ok = true
  for (const p of targets) {
    try {
      const session = await launchSession(p, { headed: false })
      await session.close()
      log(`✓ ${p}：Chrome 可启动、profile 目录可写（${sessionDir(p)}）`)
    } catch (err) {
      ok = false
      const m = err instanceof Error ? err.message : String(err)
      log(`✗ ${p}：${m}`)
      if (/Executable doesn't exist|channel|chrome/i.test(m)) {
        log('  提示：未找到系统 Chrome。装 Chrome，或设 PW_EXECUTABLE_PATH 指向 chrome，或 npx playwright install chromium 后用 PW_EXECUTABLE_PATH 指向它。')
      }
    }
  }
  if (!ok) process.exit(2)
  log('自检通过')
}

// ---------------- login ----------------
async function login(platform: ManualPlatformCode): Promise<void> {
  log(`打开 ${platform} 发布页，请用对应 App 扫码登录…`)
  const session = await launchSession(platform, { headed: true })
  const uploader = getUploader(platform)
  try {
    // 直接打开发布页（已登录会停在发布页；未登录会显示扫码）
    await session.driver.goto(uploaderEntryUrl(platform))
    await ask('扫码并完成登录后，回到这里按回车继续…')
    try {
      await uploader.checkLogin(session.driver)
      log('✓ 登录态校验通过，已持久化。')
    } catch {
      log('⚠ 仍检测到未登录标记。若你确认已登录，可能是选择器判据需更新；否则请重试 login。')
    }
  } finally {
    await session.close()
  }
}

function uploaderEntryUrl(platform: ManualPlatformCode): string {
  // 复用 registry 的发布入口（与人工发布包一致）。
  const map: Record<ManualPlatformCode, string> = {
    douyin: 'https://creator.douyin.com/',
    xiaohongshu: 'https://creator.xiaohongshu.com/',
    weixin_channels: 'https://channels.weixin.qq.com/',
  }
  return map[platform]
}

// ---------------- export ----------------
// 从中台稿件读出 BrowserPublishJob（export 与 run --content-id 共用）。动态 import 避免非该路径也加载 Payload/DB。
async function loadJobFromContent(contentId: string): Promise<BrowserPublishJob> {
  const { getPayload } = await import('payload')
  const configMod = await import('../src/payload.config')
  const payload = await getPayload({ config: configMod.default })
  const ccRaw = await payload.findByID({ collection: 'channel-contents', id: contentId, depth: 2 })
  const cc = ccRaw as unknown as Record<string, unknown> | null
  if (!cc) die(`渠道稿不存在：${contentId}`)

  // 优先用「已审批、已持久化」的发布包（与中台 ready_to_publish 一致），缺失才从当前字段重建。
  const publishResult = cc.publishResult as Record<string, unknown> | undefined
  const persisted = publishResult?.manualPackage
  let pkg: SocialPublishPackage
  if (persisted && typeof persisted === 'object') {
    pkg = persisted as SocialPublishPackage
    if (cc.status !== 'ready_to_publish') {
      log(`⚠ 稿件状态为 ${String(cc.status)}（非 ready_to_publish）；仍用已持久化发布包`)
    }
  } else {
    const { buildSocialPackage } = await import('../src/renderers/social-package')
    try {
      pkg = buildSocialPackage(cc)
    } catch (err) {
      die(`该稿不是浏览器自动发布平台或缺字段：${err instanceof Error ? err.message : String(err)}`)
    }
    log('⚠ 未找到持久化发布包(manualPackage)，已从当前字段重建（建议先在中台「提交审核→通过」生成）')
  }

  // error 级告警（缺图/缺视频等）阻断，避免发出不完整内容。
  const blocking = (pkg.warnings ?? []).filter((w) => w.level === 'error')
  if (blocking.length > 0) {
    die(`发布包有阻断级问题，请先在中台修复：${blocking.map((w) => w.message).join('；')}`)
  }

  const socialDescription =
    typeof cc.socialDescription === 'string' && cc.socialDescription.trim()
      ? cc.socialDescription
      : undefined
  return buildBrowserJob(pkg, { contentId: String(contentId), body: socialDescription })
}

async function exportJob(contentId: string, outFile: string): Promise<void> {
  const job = await loadJobFromContent(contentId)
  await writeFile(outFile, JSON.stringify(job, null, 2), 'utf8')
  log(`✓ 已导出 job → ${outFile}（平台 ${job.platform} / ${job.mode} / 素材 ${job.assets.length}）`)
  process.exit(0) // payload 会保持连接，显式退出
}

// ---------------- run ----------------
async function loadJob(opts: { job?: string; package?: string; stdin?: boolean }): Promise<BrowserPublishJob> {
  if (opts.job) {
    return JSON.parse(await readFile(opts.job, 'utf8')) as BrowserPublishJob
  }
  if (opts.package) {
    const pkg = JSON.parse(await readFile(opts.package, 'utf8'))
    return buildBrowserJob(pkg)
  }
  if (opts.stdin) {
    const chunks: Buffer[] = []
    for await (const c of input) chunks.push(c as Buffer)
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    // stdin 可以是 job 或 package：有 limits 字段视为 job，否则当 package 转
    return 'limits' in raw ? (raw as BrowserPublishJob) : buildBrowserJob(raw)
  }
  die('run 需指定 --job <file> | --package <file> | --stdin')
}

async function run(args: {
  job?: string
  package?: string
  stdin?: boolean
  contentId?: string
  report: boolean
  headed: boolean
  publish: boolean
  fillOnly: boolean
  slowMo?: number
  dryRun: boolean
}): Promise<void> {
  const job = args.contentId ? await loadJobFromContent(args.contentId) : await loadJob(args)
  if (!isManualPlatform(job.platform)) die(`job.platform 不支持：${String(job.platform)}`)
  if (args.fillOnly && args.publish) {
    die('--fill-only 不能与 --publish 同用：fill-only 只填字段、素材人工上传，无法自动发布')
  }
  const contentId = args.contentId ?? job.contentId
  const mode = args.publish ? 'publish' : 'draft'
  const interactive = Boolean(process.stdin.isTTY)

  if (args.publish && !args.dryRun) {
    if (!interactive) die('--publish 需在交互式终端二次确认；detached / 一键模式仅支持 draft')
    const a = await ask(`⚠ 将【直接发布】到 ${job.platform}（不可撤销）。输入 yes 确认，其它取消：`)
    if (a.toLowerCase() !== 'yes') die('已取消（未确认直接发布）')
  }

  log(`开始：平台 ${job.platform} / ${job.mode} / ${mode}${args.fillOnly ? ' / fill-only' : ''}${args.dryRun ? ' / dry-run' : ''}`)

  let result
  try {
    result = await runBrowserPublish(job, {
      mode,
      headed: args.headed,
      fillOnly: args.fillOnly,
      slowMo: args.slowMo,
      dryRun: args.dryRun,
      log,
    })
  } catch (err) {
    if (!args.dryRun) {
      await maybeReport(args.report, contentId, {
        platform: job.platform,
        mode: job.mode,
        stage: 'failed',
        error: redactErr(err),
        at: nowIso(),
      })
    }
    throw err
  }

  const { outcome } = result
  for (const w of outcome.warnings) log(`提示：${w}`)
  log(`标题：${outcome.filledTitle}`)

  if (!args.dryRun) {
    await maybeReport(args.report, contentId, {
      platform: job.platform,
      mode: job.mode,
      stage: outcome.published ? 'published' : 'staged',
      ...(outcome.url ? { draftUrl: outcome.url } : {}),
      ...(outcome.filledTitle ? { title: outcome.filledTitle } : {}),
      at: nowIso(),
    })
  }

  if (outcome.published) {
    log(`✓ 已发布成功：${outcome.url ?? ''}`)
    await result.closeAll()
    return
  }

  if (result.session) {
    log('✓ 已在浏览器里填好，请检查无误后【手动点发布】。')
    if (interactive) {
      await ask('完成后回车关闭浏览器…')
    } else {
      // detached（一键 spawn）无 stdin：保留浏览器直到运营关闭窗口（最多 30 分钟兜底）。
      await result.session.context.waitForEvent('close', { timeout: 30 * 60 * 1000 }).catch(() => {})
    }
    await result.closeAll()
    return
  }

  log(`✓ ${args.dryRun ? 'dry-run 完成' : 'draft 完成（headless，未保留浏览器）'}`)
  await result.closeAll()
}

// ---------------- main ----------------
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      platform: { type: 'string' },
      'content-id': { type: 'string' },
      out: { type: 'string' },
      job: { type: 'string' },
      package: { type: 'string' },
      stdin: { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      draft: { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      'fill-only': { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      report: { type: 'boolean', default: false },
    },
  })
  const command = positionals[0]
  switch (command) {
    case 'doctor':
      await doctor(values.platform ? requirePlatform(values.platform) : undefined)
      break
    case 'login':
      await login(requirePlatform(values.platform))
      break
    case 'export':
      if (!values['content-id'] || !values.out) die('export 需 --content-id <id> --out <file>')
      await exportJob(values['content-id'], values.out)
      break
    case 'run':
      await run({
        job: values.job,
        package: values.package,
        stdin: values.stdin,
        contentId: values['content-id'],
        report: values.report,
        // 真实发布一律有头（draft 需人工复核点发布；publish 也便于盯防风控）；dry-run 不开浏览器。
        headed: !values['dry-run'],
        publish: values.publish,
        fillOnly: values['fill-only'],
        slowMo: values['slow-mo'] ? Number(values['slow-mo']) : undefined,
        dryRun: values['dry-run'],
      })
      // run --content-id 用了 Payload（DB 连接常驻），显式退出。
      if (values['content-id']) process.exit(0)
      break
    case 'logout': {
      const p = requirePlatform(values.platform)
      await clearSession(p)
      log(`✓ 已清除 ${p} 登录态`)
      break
    }
    default:
      console.log(
        '用法：npx tsx scripts/publish-worker.ts <doctor|login|export|run|logout> [flags]\n' +
          '  doctor [--platform p] | login --platform p | export --content-id id --out f |\n' +
          '  run (--job f|--package f|--stdin) [--headed] [--publish] [--fill-only] [--slow-mo ms] [--dry-run] |\n' +
          '  logout --platform p',
      )
      if (command) die(`未知命令：${command}`)
  }
}

main().catch((err) => {
  console.error(`[worker] 失败：${err instanceof Error ? err.stack || err.message : String(err)}`)
  process.exit(1)
})
