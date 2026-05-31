# 浏览器自动化发布 worker · 运营操作手册

把视频号 / 小红书 / 抖音的稿件，用本地浏览器（复用你的扫码登录态）自动填表、上传、**默认只存草稿**，由你人工点最终发布。

> ⚠️ 这是「技术上可用的运营辅助自动化」，不等于平台条款允许。请自行确认平台条款与账号风险；默认存草稿、降频、单账号自然节奏使用，不要高频批量。
> ⚠️ 登录态（`~/.lilink/publish-sessions/`）等同账号凭据，**切勿提交/上传/共享**。

## 前置

1. 本机装好 **Google Chrome**（worker 默认用系统 Chrome）。若用其它路径的 Chrome/Chromium，设环境变量 `PW_EXECUTABLE_PATH=/路径/chrome`。
2. 在 `platform/` 目录装好依赖：`npm install`。
3. `export` 命令要连中台数据库，需 `set -a; source .env; set +a`（与 `wx-test.ts` 等脚本一致）。

## 一条稿子的端到端流程（明早联调按这个走）

```bash
cd platform
set -a; source .env; set +a

# 0) 自检：Chrome 能否启动、profile 目录可写
npx tsx scripts/publish-worker.ts doctor

# 1) 首次：扫码登录目标平台（每个平台各做一次，登录态会持久化复用）
npx tsx scripts/publish-worker.ts login --platform xiaohongshu
#   → 浏览器弹出，用对应 App 扫码登录，登录后回车

# 2) 从中台稿件导出 worker 可消费的 job（稿件需已「提交审核→通过」生成发布包，状态 ready_to_publish）
npx tsx scripts/publish-worker.ts export --content-id <渠道稿id> --out job.json

# 3) 跑发布（默认 draft：自动填好、上传，停在发布页交你检查）
npx tsx scripts/publish-worker.ts run --job job.json
#   → 浏览器里检查标题/正文/话题/素材无误后，自己点【发布/发表】，回到终端回车关闭

# 3') 想让它直接点发布（不可撤销，会二次确认）：
npx tsx scripts/publish-worker.ts run --job job.json --publish
```

## 命令速查

| 命令 | 作用 |
|---|---|
| `doctor [--platform p]` | 自检 Chrome 可启动、目录可写 |
| `login --platform <p>` | 有头扫码登录，持久化登录态 |
| `export --content-id <id> --out <f>` | 从中台稿件导出 job JSON |
| `run --job <f> [--publish] [--fill-only] [--slow-mo ms] [--dry-run]` | 执行发布（默认 draft） |
| `run --package <manualPackage.json>` | 直接消费「人工发布包」JSON（不连库） |
| `logout --platform <p>` | 清除该平台登录态 |

平台标识：`xiaohongshu` / `douyin` / `weixin_channels`。

## 重要开关

- **默认 draft**：只填好不点发布；headed 下保留浏览器交你点。`--publish` 才自动点发布（二次确认）。
- `--fill-only`：上传选择器若失效，用它只开页+填标题正文话题，素材你手动传（半自动兜底）。
- `--dry-run`：只校验素材可下载，不启动浏览器（先验 job 是否完整）。
- `--slow-mo 300`：每步放慢 300ms，更像真人、降低风控。
- `PW_EXECUTABLE_PATH`：指定 Chrome 路径。`LILINK_SESSION_DIR`：改登录态存放目录。
- `LILINK_BROWSER_NO_SANDBOX=1`：容器/无 GUI 服务器里加 `--no-sandbox`（桌面机不需要）。

## 选择器会随平台改版漂移

各平台创作者后台是 CSS-in-JS、动态类名，改版后选择器可能失效。worker 已尽量用稳健定位（`input[type=file]`、placeholder/role/文本锚点）并在每步给可操作中文报错。若某步报「找不到目标元素」：

1. 先用 `--fill-only` 把能填的填上，人工补完；
2. 到 `src/automation/uploaders/selectors.ts` 按注释来源更新该平台选择器（每条都标了来源与可信度）。

## 风控与安全

- 默认有头、默认存草稿、单次单稿；多账号请分别 `login`，不要同一账号多端同时在线（尤其小红书会被挤下线）。
- 出现滑块/短信验证 = 平台要人工核验，请在弹出的浏览器里人工处理，不要硬刚。
- 登录态文件在 `~/.lilink/publish-sessions/`（仓库 `.gitignore` 已兜底忽略），等同账号密码，别外传。

## 设计与实现

见 `docs/superpowers/specs/2026-06-01-browser-automation-publish.md`。引擎在 `src/automation/`，CLI 在 `scripts/publish-worker.ts`。
