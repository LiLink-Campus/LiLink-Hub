---
title: LiLink这一周解决了哪些痛点
topic: relationship
format: long
created: 2026-06-03
updated: 2026-06-03
pub_date: 2026-06-04
author: ai-assisted
human_review: pending
description: 这周我们优化了首页待办、匹配体验、iOS 响应式问题，并补上分析、可观测性和发布流程等工程基础。
tags: [LiLink, 攻略, 校园社交]
publish:
  blog:   { status: unknown }
  wechat: { status: unknown }
  x:      { status: unknown }
  lilink: { status: unknown }
source_files:
---

## lilink这一周做了什么？解决了哪些痛点

这周的核心不是加一个很大的新功能，而是把几个一直影响体验的摩擦点补上：打开首页不知道下一步做什么、匹配到的人不一定活跃、移动端页面容易被挤坏、以及产品出问题时团队不够快知道。

### UX 优化：首页待办清单更像真正的「本周议程」

之前首页能展示状态，但还不够像一个待办清单：你知道自己「处在某个阶段」，却不一定知道「现在该点哪里」。这周我们继续把首页收敛成 agenda：匹配倒计时常驻展示，需要你处理的匹配/见面提醒放在更显眼的位置，本周参与、个人名片、问卷进度、优惠券等事项放进同一组清单里。

现在每个待办项都尽量直接通向处理页面：要确认问卷就去对应问卷位置，要补联系方式就去名片页，要看可用优惠券就去券页。优惠券提醒也有了已读状态，不会在你已经看过之后还一直占着首页注意力。

公开更新也接进了 LiLink 主站：首页和导航会提示有新 devlog，访问「更新」后 NEW 标记会自动消失。这样产品变化不再只藏在群消息或开发记录里，用户也能看到最近到底改了什么。

### 追踪用户活跃数据，并应用到匹配算法：未来匹配到用户但是对方不回应的情况会越来越少

一个反复出现的痛点是：匹配到了，但对方没有回应。对用户来说，这很容易被理解成「是不是对方不感兴趣」；但从数据看，很多时候更接近「对方根本没有上线」。

所以这周我们开始记录用户的最近活跃时间，并把它接入参与状态和匹配流程。现在如果用户一周不登录，会被视为非活跃用户，默认退出下一轮匹配；后台分析也会隐藏已停用用户，避免用已经不参与的人干扰判断。

这件事不会立刻让所有匹配都变好，但它解决了一个很基础的问题：匹配池里应该优先放「真的还在使用 LiLink 的人」。长期看，匹配到以后联系不上、等不到回应的情况会越来越少。

同时，我们也修了一个参与状态的边界问题：如果用户之前默认延续了参与状态，但后来问卷里影响硬匹配的必填项变得不完整，系统会重新检查，不会把一个资料已经不合格的用户继续带进下一轮。

### 修复 responsive UI 在 iOS 上的问题

移动端尤其是 iOS 上，最容易暴露真实使用里的布局问题：中文长句、按钮、倒计时、卡片状态、优惠券内容挤在一起时，桌面端看起来正常的页面可能会突然变得难读。

这周我们修了一批 dashboard、匹配页和优惠券页的移动端布局问题，并把首页 section 间距统一，减少页面在不同宽度下忽松忽紧的感觉。对用户来说，变化不是某个单点按钮，而是整体更稳：文字不再被压成很窄的一列，关键操作不容易被挤到难点的位置，匹配等待和优惠券卡片在手机上更像一个可用产品。

为了以后不靠上线后才发现问题，我们也加了 Storybook 和响应式 smoke coverage，把关键状态放到 360、390、430、768、1280 等 viewport 下检查。以后类似 iOS/小屏布局问题，会更早在开发和发布前暴露。

### 补上 analytics、Sentry 和生产发布基础

还有一类改动用户平时不一定直接看到，但会决定产品能不能稳定迭代。

这周我们补了 first-party analytics，用来回答「用户有没有看到这个功能、有没有点击、有没有完成结果」这类产品问题；接入了前后端 Sentry，让生产问题能更快被发现；也拆分了本地和生产 compose/Docker 配置，收紧 secret 边界，减少部署时跑错环境或泄漏敏感配置的风险。

这些改动的目标很朴素：当有人反馈「不知道优惠券在哪」「为什么匹配不到」「页面在手机上坏了」时，我们不只靠猜，而是能用更清楚的数据、错误现场和发布流程去修。

------

## 更多技术细节 by [s3d-i](https://github.com/s3d-i)：

### 匹配数据与算法分析：为什么匹配失败？

这次我们把最近 8 个已揭晓周期重新导出，按「eligible user-cycle observation」建模：一个用户在一周内 opt in、状态 ACTIVE、问卷硬匹配字段完整、并且有本周 intent，就形成一条 observation。这个口径下共有 742 条 eligible observation、179 个 distinct eligible users，其中实际匹配 489 条、未匹配 253 条。

![LiLink 8周匹配数据中不同偏好桶的匹配率与目标压力关系](./assets/matching-pressure-by-bucket.png)*8周匿名聚合 replay。左图按偏好桶展示匹配率，右图展示 median target pressure 与未匹配率的关系；只展示 observation 数量不低于 10 的桶。*

#### 分布概览：不是所有偏好桶都一样难

如果只看总体匹配率，8 周内 eligible observation 的实际匹配率约为 65.9%。但总体均值会掩盖偏好桶之间的强差异。最大的困难桶是 `男 -> 女`：393 条 observation、94 个用户、匹配率 47.1%、未匹配率 52.9%。作为对照，`女 -> 男` 有 123 条 observation、匹配率 90.2%；`女 -> 男+女` 有 67 条 observation、匹配率 94.0%；`男 -> 男+女` 有 45 条 observation、匹配率 88.9%。

这不是简单的「某一周运气不好」。在 `男 -> 女` 桶里，median target pressure 是 2.54，含义是：寻找目标性别集合的人数，大约是目标性别供给人数的 2.54 倍；过滤硬约束、历史重复和 block 之后，median compatible degree 只有 16。`女 -> 男` 桶的 median target pressure 只有 0.66，median compatible degree 是 27。换句话说，一个桶是「很多人争同一类稀缺供给」，另一个桶是「目标供给相对充足且候选边更多」。

第 8 周的图结构也符合这个判断：在所有 opted in 用户中，匹配成功率 33.1%，未匹配成功的人中约 5/6 属于「在有限供给中，当前轮没有被分配到边」。

#### 假设：长期匹配困难主要来自供需压力和图结构

我们用一个轻量解释模型检验这个假设。特征包括 target pressure、compatible degree、previous unmatched streak、硬约束宽窄等；结果变量是该 user-cycle 是否未匹配。模型预测 `P(unmatched)` 的 AUC 为 0.802。标准化系数方向也符合直觉：`logTargetPressure` 为 +0.921，目标供给越拥挤，未匹配风险越高；`logCompatibleDegree` 为 -0.714，候选边越多，未匹配风险越低。

分桶检验也支持同一个结论：`男 -> 女` 相对其它桶的未匹配 odds ratio 是 7.52，95% CI 为 5.20 到 10.88；只寻找 `女` 的用户，相对只寻找 `男` 的用户，未匹配 odds ratio 是 7.38，95% CI 为 4.41 到 12.33。桶级 median target pressure 与 unmatched rate 的相关系数是 0.785。

长期困难用户也集中在同一侧。对 opt-in 次数不少于 3 的用户，`男 -> 女` 桶里有 71.2% 的用户未匹配率不低于 50%；never matched 有 5 人。`女 -> 男` 和 `女 -> 男+女` 桶里，同样条件下的 high-unmatched 用户为 0。

数据进一步说明活跃用户也会被结构性供需挤出：在「高需求 + 高活跃」用户中，高压力桶 34 人里有 22 人属于长期困难，平均用户匹配率 52.8%；非高压力桶同样 34 人里只有 1 人长期困难，平均用户匹配率 92.2%。

#### 匹配到的对方联系不上，是不喜欢我还是单纯没上线？

另一个相关痛点是「匹配到了但对方没有回应」。这里的数据证据比供需失衡弱，因为我们刚刚上线用户数据分析和可观测性。

我们在 2026-06-03 20:47（中国时间）连生产库做了一次即时校验。第 8 周 reveal 时间是 2026-06-02 21:00（中国时间）。

答案是：主要是对方根本没有可观测上线，但确实有一部分是对方上线后没有可观测站内回应。第 8 周的真实双人 pair 中，32.7% 双方都没有 reveal 后可观测上线；36.4% 是一方上线、一方没上线，且上线的一方请求了联系方式；只有 5.4% 是至少一方上线但都没有请求联系方式。

局限性：一方请求联系方式后，系统会 introduce 这对 match 并发送联系邮件。后续如果两个人在站外联系，产品看不到。即便如此，我们也能看到平台存在不少不活跃用户（匹配揭露的一天内未登录），这些用户现在会自动被opt out若一周不上线

#### 正在改进的方向

现有的匹配问卷实际上是软且噪音大的prior，多项研究说明类似的性格问卷并不能真的有效预测两人是否真能合拍。因此，在仅有现有问卷的情况下高压力桶内的用户长期匹配不上是需要解决的合理fairness诉求，同时我们也需要更加细致建模用户：

- 利用unmatched-streak改进高压力桶内的匹配轮转
- 渐进引入兴趣标签
- 引入互评系统在1v1和多人局，收集更多数据尝试 reciporal collaborative filtering

### first-party analytics，可观测性基建与生产部署流程优化

#### analytics 要回答怎样的问题, 要如何设计确保可维护性又不过度工程化?

有人反馈说不知道优惠券在哪里; 有人反馈说对象匹配不到; 有人不知道可以添加微信号; 有人不知道怎么举报.

我们需要衡量各个功能组件的实际用户触达足迹, 以支持产品决策: 未来要不要做onboarding guide? 要不要把某个重要功能放到其他位置? 有没有什么设计实际是冗余的, 用户永远不会交互?

参考成熟RUM/product analysis, 我选择「足迹 -> 意图 -> 结果」的分层. 并确保前后端, 数据库边界权责清晰.

在让AI完成的过程中, 它犯了错. 比如 `page_viewed` 和 `component_viewed` 用同一套判断. 这在代码上很诱人, 类似 IntersectionObserver 抽成一个hook就结束了. 但语义上不对.

*Analytics 必须要语义精确!*

如果把page root也要求成 50% visible + 900ms, 在移动端、长页面、layout shift、快速跳转时都会系统性漏记. 反过来, `component/surface viewed` 的含义是「用户真的有机会看到这个具体控件或信息」, mount不算, 被折叠在首屏下也不算.

analytics很容易滑向「先多收点以后再说」. 但LiLink的数据里有联系方式、学校、匹配关系, 所以我给AI的限制是：metadata只能按白名单进. first-party analytics不是 tracking, 我们只收产品判断真正需要的结构化事实.

outcome事件还有一个容易被AI写错的点：它会倾向在业务service里直接插一条ProductEvent. 这在demo里能跑, 但不是我想要的生产语义.

业务事实和analytics记录必须解耦. 用户申请联系方式、商家核销优惠券、双方最终确认约见, 这些主流程不能因为analytics写入失败而失败. 但反过来, 这些outcome又不能随便丢, 因为它们是漏斗最后一步. 所以业务事务里只写outbox, 后台再flush到ProductEvent; 失败可以重试, 重复可以靠确定性的event id去重, 每天再从真实业务表reconcile最近一段时间的outcome.

analytics一旦参与产品决策, 它就不能只是best-effort log, 但它也不能反过来成为业务系统的blocking单点故障, outbox正好卡在这两个约束之间.

#### 接入sentry, 在生产出事时及时知道

前后端都接入, 添加必要的breadcrumb, beforeSend脱敏, production按分类采样率收trace/replay, source map部署自动上传.

这里AI容易忽略的是secret边界. `SENTRY_AUTH_TOKEN` 不能作为普通build arg或runtime env进Docker, 泄漏风险. 最后采用的是BuildKit secret只在build时可见, build完上传source map. 其实也可以在build过程中inject, 分离部署和sourcemap上传, 更优雅但需要单独保证部署和sourcemap版本一致, 目前无需求.

#### 生产部署流程优化

思路和 analytics 类似：不要把关键语义藏在隐式环境里。之前 prod 实际上依赖一个长期被 neglect 的 worktree / Dockerfile 来 run API，连的是生产 Neon DB；这意味着生产环境和开发分支不是同一条受控路径，而是在持续 drift。这次我们把相关入口和路径配置化，明确拆开 local / prod 的 Dockerfile、compose 和 env secret 边界，让开发、CI、preview、production 各自的假设写在配置里，而不是靠人记。

local compose只做本地Postgres/Mailpit/可选API, prod compose只做生产API. 生产env通过Docker secret进entrypoint, 而不是暴露在compose environment里. 这样 `docker inspect` 和 `docker exec env` 不会直接显示DATABASE_URL/JWT/SMTP这类secret. 发布命令也收敛到root scripts, 由脚本固定prod compose、BuildKit、release解析, 减少「我以为我跑的是生产配置」这种人为错误.

最后pin node/npm 解决了工具链一致性问题(如果不pin可能出现package-lock在不同环境不同), web production typecheck和storybook/test tsconfig分开.

越是小团队, 越不能把生产安全寄托在「这次应该不会忘」上.

### 添加storybook，以在上线时检测各种viewport的responsiveness

responsive 问题需要两条路径：一条方便人看，一条方便 AI 和自动化看。

给人看的路径是 matrix。matrix 要把高风险状态和关键 viewport 摊在同一张画布里：一边是不同页面状态，一边是 360、390、430、768、1280 这类代表性宽度。

![Storybook 中用于检查匹配页不同状态和 viewport 的 responsive matrix](./assets/storybook-responsive-matrix.png)*Storybook responsive matrix：把高风险页面状态和代表性 viewport 放在同一张画布里，方便上线前快速扫出文字溢出、按钮挤压和移动端层级问题。*

这条路径服务人的视觉判断. 很多 responsive bug 不是测试能轻易断言的布尔值，而是「看起来已经不像一个可用产品」：易读性，CTA 显眼性，中文、英文和数字混排后节奏变差。matrix 的意义就是把这些问题集中暴露出来。

给 AI 看的路径则相反：把页面拆成小组件、稳定 fixture 和 Playwright 可以操作的 case。AI 更擅长处理明确边界：这个按钮在 loading/disabled/normal 下是否还能渲染；这个卡片在长文案下是否报错；这个交互点击后是否出现预期文案。小组件 story 和 fixture 给 AI 提供抓手，Playwright 再把这些抓手变成可重复运行的 smoke check。

fixture 一定要写成 adversarial data。真正会打爆 responsive 的通常是状态空间内的最差组合. Responsiveness 是 viewport、内容长度、字体宽度、页面状态和交互密度共同形成的覆盖问题



## 正在优化中

### 多人局匹配

有反馈称一周一次匹配机会太少了；这些用户在新的多人局中，也许能交到朋友或对象。多人局将默认一周一次，是额外的交友机会。

### 匹配后互评反馈

互评反馈将会分类：个人偏好、对方的受欢迎程度（如易于沟通性），以及安全性举报（如骚扰行为）。现有反馈入口会合并其中。

### 非侵入式的兴趣标签系统

我们会避免把兴趣标签系统做得过重、有摩擦，不会要求用户一次填写大量内容。

### 敏感数据访问权限系统

微信、手机号、姓名等都属于敏感信息。当能接触生产环境的人可能超过 2 人时，受限访问的设计和审批流程变得必须。