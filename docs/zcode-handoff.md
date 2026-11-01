# ZCode 版「刷B站」交接文档

> 日期：2026-11-01
> 用途：新会话接手 `zcode-bili-duty` MVP
> 原则：本文只写「读什么、服务器是什么状态、已做什么、下一步」；细节以链接文件为准。
> ⚠️ 仓库是公开的：本文里的服务器 IP / UID 用占位符；真实值见服务器或本地笔记，不要提交。

---

## 0. 一句话状态（2026-11-01 21:25 CST 更新）

- **复查的 1~7 条已修**（DSH 章程工具名、评论风格重试、MCP 启动自愈、DSH MCP 客户端、daemon 崩溃窗口、collectTimes 截断、凭据过期预检）；第 8 条 stderr 1113 风险本轮未动。只读全量审查的 15 条已处理 15 条（私信收件人/闸门、manualExtra、窗口回滚、严格配置、交互式 MCP 数据目录、锁、reportLevel 配额、stream 监听/跨块、hook 非 JSON、MCP 重建、转写路径、4h 宽限、凭证校验）。单测 **88/88** 通过；`zcode plugins validate` 通过；daemon 已重启到新代码（PID 102847）。
- `userConfig` 现在也有桥接：daemon/hook 会读 `~/.zcode/cli/config.json` 的 `plugins.options`，显式设置过的字段优先于 `config.json`；交互式 MCP 的数据目录走 `dataDir` / `BILI_DUTY_CONFIG_HOME`。注意：若在 ZCode 设置页显式改过某字段，想再用 `bili-duty config set` 改同一字段，需要先在设置页把它清空/恢复默认。
- 方案已定稿，并已合入 spike 实测发现：[zcode-port-plan.md](zcode-port-plan.md)。
- **批量私信试点（2026-11-01 22:40 起）**：`perDay=20`、`maxPerRound=5`、`roundTarget=3`、`fetchPerRound=10`、`dmBatchMax=5`；一轮私信 = 1 条总结 + 最多 5 条视频消息，消息间 3 秒延时；2026-11-01 22:30 窗口已标记跳过，2026-11-02 08:30 开始按新配置跑。
- `zcode/` 子包已完成核心骨架、Python MCP 工具代理、`bili_run` / `admin_*`；**88 个单测**、`zcode plugins validate` 通过。
- 已提交：`e447a23`（MVP 骨架）、`7182203`（MCP structuredContent 与 1113 误报修复）、`18f98ff`（私信投递记录）、`2c75e25`（systemd 调度与通知窗口）、`68dc89e`（systemd 上线记录）。
- **真实一轮（只写报告）已跑通**（17:02–17:05）；**真实私信测试已跑通**（17:10–17:13，444 字被拒后 338 字成功）。
- **systemd 已安装并运行**（17:35:11 CST，`enabled` + `active`，PID 55346）。
- **72 小时试点已启动**：`collectTimes=08:30,12:30,18:30,22:30`、`perDay=4`、`fetchPerRound=5`、推荐流 `ps=50`；首轮手动测试于 17:51 启动。目标：观察 token 和 B 站风控，再决定是否扩到 12 轮。
- **试点首轮结果**（17:51–17:55）：215 秒、**242,365 token**（7 次请求，cache 184,896）、挑 2 条（`BV1bpxe61EU6` / `BV186pc65E68`）、读 3 条字幕 + 2 次画面、无 B 站错误。私信被 4 小时窗口挡下（17:13 的测试私信）；测试账本已存档为 `dm-deliveries.test-20261101-1713.jsonl`，新账本从 0 开始。今天配额 4/4，18:30/22:30 跳过；第一次自动轮是明天 08:30。
- **token 量级修正**：首轮 5 条细看 + 50 推荐约 **24.2 万 token**；20:07 自动轮（5 条细看、挑 4 条）约 **34.2 万 token**。4 轮/天大约 **1–1.4M token/天**，远低于之前 3–6M 的粗估；72h 后再按实际外推（12 轮 × 10 条的量级也会比 18–36M 低很多）。
- **立即发送测试**（18:01）：宿主直接调 `bili_send_message` 发同一份私信（365 字，回执 `7703140961428716000`）成功；这条走宿主 MCP、不经过模型的 PreToolUse 闸门，也不写 `dm-deliveries`，所以不算通知窗口。
- **自动额度已恢复**：今天 4 条都是手动轮 ⇒ `state.manualExtra=4`，`autoPicked=0 / left=4`；18:30 的自动轮可以正常跑。手动试点和 dry-run 的 run 目录已归档为 `runs/test-*`，`usage --days=1` 从 0 开始，72h 统计不会被测试污染。
- **prompt 修正**：`prompt.mjs` 改用 `autoPickedToday` + `manualExtra`，手动轮不再占自动额度（41 单测通过）。
- **18:30 自动轮失败并修复**：scheduler 把 `log` 函数传给 runner，而 runner 需要 logger 对象 ⇒ `TypeError: logger.error is not a function`，那一轮没有启动、也没有私信。已改成 scheduler 不再传 log + runner 兼容函数/对象，并重启 daemon（PID 63525）。
- **20:07 自动轮验证成功**：临时时点 20:07 跑了一轮，4 条、342,398 token（9 请求）、私信成功 `msg_key=7703174508620221000`，**主号已确认收到**；今天 auto 4/4，22:30 会跳过。`collectTimes` 已恢复为 08:30/12:30/18:30/22:30。
- **4 轮结构修正**：新增 `maxPerRound=1`。20:07 那轮把 4 条额度一次用光，导致后面 3 轮会全部跳过；加上每轮上限后，明天 08:30/12:30/18:30/22:30 每轮最多挑 1 条，才能跑满 4 轮。明天第一轮的提示词已验证为「今天还剩 4 条，这一轮最多再挑 1 条」。
- **人设已接通**：`personaPrompt` 支持文字或文件路径；留空自动读 `workspace/AGENTS.md`。提示词还补了本地转写状态、评论长度、回复评论开关（46 单测通过）。
- **`bili_recommend(ps=50)`**：首页接口单次只回 30 条，连续两次 0 重叠 ⇒ 工具内部拉两次合并（ps<=30 时仍只拉一次）。runner 已把 provider 汇总的 usage 写进 `result.json`，可用 `bili-duty usage --days=3` 汇总。
- 修了两个真 bug：MCP structuredContent 协议要求；`isAuthError` 把 stream 的 `seq:1113` 当鉴权失败。
- 服务器当前状态：插件以 **inline** 方式挂在 `~/.zcode/cli/config.json` 的 `plugins.dirs`；`dmMode=only`、`dmUid=<MAIN_UID>`、`autoComment=false`、`dmWatch=false`。真实 UID 只在服务器配置里。
- 下一步：72h 试点观察（每天看 `usage` / journal / 报告）；之后决定扩 12 轮；login/setup 迁移、复核/收藏/笔记/判重滚动。

---

## 1. 必读文件（按顺序）

| 顺序 | 文件 | 为什么 |
|---|---|---|
| 1 | [AGENTS.md](../AGENTS.md) | 仓库约定、DSH 版背景、安装/发版规矩 |
| 2 | [docs/zcode-port-plan.md](zcode-port-plan.md) | 主方案：架构、目录、模块边界、接口、任务、风险、部署。**读全文**；重点 §0 / §0.1 / §3 / §4 / §5 / §6.3.4 / §10–§16 |
| 3 | [docs/zcode-spike-summary.md](zcode-spike-summary.md) | spike 实测结论：凭据同步、providerOrder、OpenAI 端点、systemd、私信 |
| 4 | [zcode/](../zcode) 全部 | 当前实现（36 个文件）：`bin/`、`src/`、`hooks/`、`test/`、`skills/`、`commands/`、`.zcode-plugin/plugin.json`、`.mcp.json` |
| 5 | [prompts/duty.md](../prompts/duty.md) | 值班章程原文；`zcode/skills/bili-duty/SKILL.md` 是 ZCode 的副本（额外带 `duty_comment_append` 说明） |

**后续功能再按需读**（不要一上来全读，太占上下文）：

| 要做的事 | 读哪个 |
|---|---|
| 复核评论 | [lib/verify.mjs](../lib/verify.mjs) |
| 私信收发 | [lib/dm.mjs](../lib/dm.mjs) |
| 扫码登录 | [lib/login.mjs](../lib/login.mjs) |
| 安装 / uv 自举 | [lib/uvfetch.mjs](../lib/uvfetch.mjs) |
| 时间 / 判重 / 章程升级 | [lib/state.mjs](../lib/state.mjs) |
| 移植剩余 DSH 行为 | [index.js](../index.js) 只按 §9 映射表找对应函数（`runDuty` / `promptFor` / `tick` / `runVerify` / `favToday` / `parseSeenTable` / `rollSeen` / `dmTick` / `runInstall`） |
| 改 B 站工具 | [vendor/bilibili-mcp/mcp_server.py](../vendor/bilibili-mcp/mcp_server.py) 的 `_ALLOWED` / `_guard` / `@tool()` 区域，不用全读 |
| Web 面板 | [client.js](../client.js)（MVP 不需要） |

**不要读 / 不要打印**：`~/.zcode/v2/credentials.json`、`bili_credential.json`、`provider.recommended.json` 里的 API key。用 `ls -l` 看权限即可。

---

## 2. 服务器

```bash
ssh -i ~/.ssh/<your-key> bili@<ECS_PUBLIC_IP>
```

| 项 | 值 |
|---|---|
| 系统 | Ubuntu 22.04.5 LTS x86_64 |
| 规格 | 2 vCPU / 3.6GB RAM / 40GB SSD（35GB 可用） |
| 时区 | `Asia/Shanghai`（已确认） |
| Node | v22.23.4 / npm 10.9.9 |
| ZCode CLI | 3.16.6 |
| Python | 3.12.16（uv 创建 venv） |
| uv | 0.13.6 |
| 数据目录 | `/home/bili/bili-duty` |
| 开发副本 | `/home/bili/zcode-dev/zcode`（**只是同步副本，源码真相在本地 repo**） |
| 测试脚本/报告 | `/home/bili/spike-notes/` |

**凭据与 provider**：

| 项 | 路径 / 值 |
|---|---|
| ZCode 凭据 | `/home/bili/.zcode/v2/credentials.json`（600，桌面端同步） |
| B 站测试小号 | `/home/bili/bili-duty/bili_credential.json`（600，UID `<TEST_UID>`） |
| 主号 UID | `<MAIN_UID>`（**已确认能收到私信**） |
| provider | `/home/bili/bili-duty/providers/provider.recommended.json`（`bigmodel-flash-openai / GLM-5.3-Flash`，OpenAI 兼容端点） |

---

## 3. 用户约束与已定决策

- 部署在**阿里云杭州**，无头 Ubuntu；不使用 ZCode Desktop UI Plugin / 「自动化」。
- **只私信**（`dmMode=only`），评论默认关；评论只做冒烟测试，测完删除。
- **低频优先**：2 次采集/天；4h 通知窗口可调；不要 1 分钟轮询私信（只发不收时 `dmWatch=false`）。
- 模型混用 BigModel / StartPlan / API key；推荐 provider 为 `bigmodel-flash-openai / GLM-5.3-Flash`。
- 最小权限是**策略闸门**（`--disallowed-tools` + PreToolUse + Python `_guard` + systemd/专用用户），不是 DSH 的 profile 沙箱。
- 不提交/推送，除非用户明确要求；一个人一件事一个 PR；不要改 DSH 的 `index.js` / `client.js`。
- 交流用中文；先给证据和风险，不要空口承诺。

---

## 4. 当前实现（`zcode/`）

| 模块 | 作用 |
|---|---|
| `src/paths.mjs` | 数据目录 / 插件目录 / 共享资产解析；预建 `seen.md` |
| `src/time.mjs` | `Asia/Shanghai` 时区、dayKey、跨零点窗口、seen 日期容错 |
| `src/config.mjs` | 默认值、优先级（config.json > env > 默认）、范围钳制、CLI 类型解析 |
| `src/log.mjs` / `lock.mjs` / `state.mjs` / `quota.mjs` | 日志轮转、运行锁、日切、`### BV` 配额 |
| `src/credentials.mjs` | 凭据同步/检查、1113/401 识别（已修 UUID 误报） |
| `src/provider.mjs` | 兼容 `{schemaVersion, config}` 包装，校验 `providerOrder` / OpenAI 端点 |
| `src/allowlist.mjs` + `hooks/pre-tool-use.mjs` | 值班轮工具白名单 + 评论/私信闸门 |
| `src/prompt.mjs` + `src/runner.mjs` | 拼章程提示词、spawn `zcode --prompt`、stream-json、超时/锁 |
| `src/mcp-client.mjs` / `src/python-mcp.mjs` | 极简 MCP stdio 客户端 / Python MCP 子进程生命周期 |
| `src/home-files.mjs` | 把 `mcp_server.py` / `asr.py` / `favops.py` 铺到数据目录 |
| `src/status.mjs` / `src/diagnostics.mjs` | 状态与环境自检，CLI 和 MCP 工具共用 |
| `src/tools/admin.mjs` | `bili_run` + `admin_*` 工具实现 |
| `bin/bili-duty.mjs` | CLI：status / config / sync-credentials / provider / doctor / run |
| `bin/mcp-server.mjs` | 动态返回 Python 工具 + 本地工具，代理调用并透传 image content |
| `bin/daemon.mjs` | systemd 常驻骨架（调度/私信循环未接） |
| `skills/bili-duty/SKILL.md` + `commands/bili-duty.md` | 章程与命令入口 |

工具面：18 个 B 站/duty 工具（`bili_search` / `bili_subtitle` / `bili_comments` / `bili_video_info` / `bili_danmaku` / `bili_cover` / `bili_frames` / `bili_recommend` / `duty_*` / `bili_transcribe*` / `bili_reply` / `bili_send_message`）+ 10 个本地工具（`bili_status`、`bili_run`、`admin_status`、`admin_config_get/set`、`admin_sync_credentials`、`admin_provider_check`、`admin_doctor`、`admin_setup`、`admin_login`）。

---

## 5. 已验证结果

- 单测 **88/88 通过**：`cd /home/bili/zcode-dev/zcode && node --test test/*.test.mjs`；DSH 根包 `node --test test/mcp-client.test.mjs` **2/2**
- `zcode plugins validate /home/bili/zcode-dev/zcode --json` → `ok: true`
- MCP `tools/list` → 29 个工具（Python 19 + 本地 10），包含 `duty_comment_append`
- MCP 在坏 `config.json` 下仍会返回 `isError: true` 的错误结果（不会让请求悬空）
- MCP 工具列表启动失败后会在下一次 `tools/list`/未知工具调用时重试；`McpClient` 初始化失败会清掉子进程
- DSH 根包 MCP 客户端：spawn 失败/初始化前退出后都能再次 `start()`（2/2 测试）
- `collectTimes` 12 个时点完整保留（不再截断为 8）
- 调度窗口用 `{pid,at}` 表示运行中、`true` 表示完成；死进程留下的 running 标记会重跑
- 凭据预检支持 JWT `exp` 和 `user_info.expiresAt/expireTime`；当前服务器凭据没有可读的过期字段
- PreToolUse 权限矩阵：值班轮搜索/写判重表 allow；转写关闭 deny；私信收件人匹配 allow、不匹配 deny；回复关闭 deny；坏配置值班轮 deny、非值班轮 allow
- 评论/回复条数：同一 runId 下 `commentPerRound=1` / `replyPerRound=1` 的第二次调用被拒；槽位用 `wx` 原子创建，并发也不能超发
- 跨午夜补跑：昨天 23:30 未跑会在 00:05 补一次；已成功的窗口不会重复；`state.windows/failures` 保留两天
- `userConfig` 桥接：显式 `plugins.options` 被 daemon/hook 读取并优先于 `config.json`；`dataDir` 能正确改 home
- `duty_comment_append` 直接调用测试：rpid 行插到「评论记录」表、`## 看过的视频` 之前
- 批量私信：本地钩子烟测 `summary → 5 videos` 共 6 条允许、第 7 条拒绝；模拟 `success:false` 后名额退回、重试允许（未调用真实 B 站接口）
- Python 账本写入 `batch` 字段；无 env 时从 `dm-batch.json` 兜底取 runId，避免 ZCode 不继承环境变量时把一条私信拆成多次通知
- 2026-11-01 22:40 `bili-duty run --dry-run` → `ok: true`、`code=0`、10.3 秒、usage 8,372 token（验证新 runner 的 stream/close/usage 收尾）
- 交互式数据目录：`BILI_DUTY_CONFIG_HOME=/home/bili/bili-duty` 下 `bili_status.home` 正确；插件选项 `dataDir` 已写入 `~/.zcode/cli/config.json`（备份同目录 `.bak-*`）
- `bili_search` 代理成功（真实搜索结果）
- `duty_paths` / `duty_seen_recent` 正常
- `bili_cover` 返回 `["text","image"]`，图片块透传成功
- MCP 在 stdin 关闭后优雅退出（exit 0），Python 子进程会被收掉
- `bili-duty status` / `provider check` / `doctor` 全绿

---

## 6. 未完成 / 下一步

按优先级：

1. ~~**真实一轮**~~：已完成（17:02–17:05），报告/判重/归档正常。
2. ~~**systemd 调度**~~：已完成并上线（17:35 CST，`enabled` + `active`，PID 55346；全修后 22:40 重启为 PID 102847）；代码为 `bin/daemon.mjs` + `src/scheduler.mjs` + `src/notify.mjs` + `deploy/bili-duty.service`，88 单测通过。
3. ~~**私信发送**~~：已完成（17:10–17:13）；444 字被 `21007` 拒，338 字成功，回执已记录。
4. **login / setup 迁移**：把 spike 的 `login_qr.py` 和 uv/venv 安装逻辑搬进 `src/login.mjs` / `src/install.mjs`。
5. **复核 / 收藏 / 笔记 / 判重滚动**：参考 `lib/verify.mjs`、`lib/favops.py`、`index.js` 对应段。
6. ~~**build / 部署包**~~：已完成 `zcode/build.mjs`（把 `vendor/`、`lib/asr.py`、`lib/favops.py`、`prompts/` 一起打进 `dist/`）；`deploy/bili-duty.service` 已上线。
7. **上线前**：72h 低频 soak、S7 真实性能、S8 章程质量。
8. **私信长度**：实测 444 字会被 `21007` 拒；在 prompt/章程里把目标收紧到 ~350 字，减少一次失败重试。
9. **72h 试点（进行中）**：4 轮/天（08:30/12:30/18:30/22:30）、`perDay=20`、`maxPerRound=5`、`roundTarget=3`、`fetchPerRound=10`、推荐流 50 条、私信“1 条总结 + 最多 5 条视频消息”。2026-11-01 22:30 已标记跳过；2026-11-02 08:30 开始按新配置跑。看 `usage`、journal、报告质量与 B 站风控，再决定是否把 `roundTarget` 提到 5。
10. **全量审查修复**：15 条已全部处理（见 §0）；`userConfig` 通过 `plugins.options` 桥接到 daemon/hook。当前工作树有一大批未提交改动，提交前先跑 §5 的 88 单测与 validate。

---

## 7. 已知坑

- **服务器不能独立 OAuth**：`zcode login` 会 1113；必须同步桌面端 `~/.zcode/v2/credentials.json`；过期后要重新同步。
- **provider 由 `providerOrder` 第一位决定**：`defaultModelSelection` 会被忽略；每次 spawn 用 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指定文件。
- **视觉必须 `openai-chat-completions` + 自定义 provider ID**：`anthropic-messages` 只给 OSS 链接、看不到像素。
- **`isAuthError` 不要匹配裸 `401` / 裸 `1113`**：事件 UUID、`seq` 里都可能含这些数字，会误报；只认结构化错误，且正则要带 `code/status/error/message` 上下文。
- **私信长度实测**：444 字被 B 站以 `21007 消息过长` 拒绝，338 字成功。目标控制在 ~350 字以内，别按 500 字顶格写。
- **`BILI_DUTY_RUN_DAY`**：Python MCP 只有看到这个日期（`YYYY-MM-DD`）才会把私信里的 BV 写进 `dm-deliveries.jsonl`；runner 现在会自动设，手工跑时也要 export。
- **推荐流 50 条**：`homepage.get_videos` 单次固定回 30 条，连续两次 0 重叠；`bili_recommend(ps=50)` 内部拉两次合并去重，`ps<=30` 仍只拉一次。
- **token 统计**：runner 从 stream 的 provider 汇总事件取 usage，写进 `runs/<runId>/result.json`；`bili-duty usage --days=3` 汇总最近 N 天（旧 run 没有 usage，会显示 `usage:null`）。
- **手动轮额度**：`state.manualExtra` 记手动轮多挑的条数；`quota.autoPickedToday` 会减去它，所以手动轮不占自动额度。`prompt.mjs` 和 scheduler 都用这个口径。
- **立即发送测试**：直接调宿主 MCP 的 `bili_send_message` 会绕过 PreToolUse，也不写 `dm-deliveries`；只用于验证发送链路，正式轮仍走通知窗口。
- **scheduler 与 runner 的 log 契约**：scheduler 的 `log` 是函数，runner 要的是 logger 对象（`.info/.warn/.error`）。2026-11-01 18:30 就是因为直接传函数导致 `logger.error is not a function`；现在 scheduler 不传 log，runner 也兼容函数/对象。改动 `tick`/`runRound` 时别再打破这个契约。
- **配置损坏不再静默回退**：`loadConfig` 对「文件存在但读不了 / 不是 JSON 对象」直接抛错；daemon 启动失败、hook 值班轮拒绝、MCP 返回 `isError`。不要再用 `readJson` 吞配置错误（`state.json` 可以吞，`config.json` 不行）。
- **runner 只把 stdout 当 stream-json**：stderr 只进 `stderrTail` 和 `stream.jsonl`，不能混进跨块行缓冲；否则 zcode 的日志会把半行 JSON 弄坏。
- **窗口失败会回滚**：scheduler 在跑之前标记 `windows[key]`，但 `runRound` 返回 `ok:false`/锁冲突时会删掉窗口并记 `state.failures[key]`，2 分钟后重试；不要恢复成“先标记、失败也算跑过”。
- **锁不按 TTL 抢活进程**：`acquireLock` 只覆盖死 pid；同一进程的重叠由 runner 的 `activeRound` 挡。`run-lock.json` 里 `pid:0` 表示已释放。
- **交互式 MCP 的 home**：`.mcp.json` 不覆盖 `BILI_DUTY_HOME`；独立会话通过 `BILI_DUTY_CONFIG_HOME`（插件 `dataDir`）指向真实数据目录。服务器已设 `dataDir=/home/bili/bili-duty`；换机器时要改这一项。
- **userConfig 的优先级**：显式保存在 `~/.zcode/cli/config.json` 的 `plugins.options` 现在会被 daemon/hook 读取，并优先于 `config.json`；未显式改过的字段仍用 `config.json`。若两者都设置了同一字段、又想以 CLI 为准，先在设置页清空该字段。
- **`config set` 先整组校验再写**：非法 key 不会留下“前几条已保存”的半套配置。
- **通知窗口**：`hooks/pre-tool-use.mjs` 对 `bili_send_message` 按 `notifyEveryHours`（默认 4h）/ `quietHours`（默认 23:00–08:00）/ `notifyMaxPerDay`（默认 4）/ `notifyOnlyWhenNew` 收口；`dm-deliveries.jsonl` 的 mtime 就是「上次通知时间」。4h 轮次与 4h 窗口留了 5 分钟宽限，避免差几秒误拒。
- **自动采集开关**：`peakValley=true` 时 daemon 才按 `collectTimes`（默认 12:30 / 20:30）跑；错过时点 60 分钟内会补跑，同一时点用 `state.windows[day@HH:MM]` 去重。
- **跨午夜补跑**：`state.windows/failures` 保留昨天和今天；00:xx 会检查昨天 23:xx 的窗口，已成功的跳过，未跑过的补一次。不要恢复成日切时清空这两张表。
- **评论条数硬闸门**：`src/comment-gate.mjs` 按 `runId + 日期` 用 `wx` 原子创建槽位；`commentPerRound` / `replyPerRound` 到上限就拒绝，并发调用也不能超发。槽位在发送前占；`blocked_by: style` 由 PostToolUse 钩子释放，让“改写一次再发”仍能工作。
- **评论 rpid 记录**：`duty_comment_append(bvid, rpid, root, text)` 把行插进 `seen.md` 的「评论记录」表，位于 `## 看过的视频` 之前；`rpid` 必须是数字，没取到就别编。该工具名只写在 ZCode 的宿主提示里，共享章程保持通用，避免 DSH 调用不存在的工具。
- **MCP 启动自愈**：`bin/mcp-server.mjs` 启动失败不会把列表永久锁成空；下一次 `tools/list`/未知工具调用会重试。`McpClient` 的 initialize 失败会杀掉子进程并清 `proc`。
- **窗口标记**：`state.windows[key]` 现在是 `{pid,at}`（运行中）或 `true`（已完成）；daemon 在运行中被杀/重启后，死进程的 running 标记会被当成没跑过，不再丢时点。
- **collectTimes 不截断**：`normalize` 不再只保留前 8 个时点；12 轮/天可以真的配置 12 个。
- **凭据过期预检**：`checkCredentials` 会读 JWT `exp` 以及 `user_info` 等 JSON 里的 `expiresAt/expireTime`；当前服务器凭据没有可读的过期字段。
- **批量私信**：一轮 = 1 条总结 + 最多 `dmBatchMax` 条视频消息；`dm-batch.json` 记 runId/sent/lastAt，后续消息跳过 4h/每日上限但仍查静默时段和 only-new；消息间 3 秒延时；`success:false` 由 PostToolUse 退回名额。
- **通知计数**：`dm-deliveries.jsonl` 每条带 `batch`，每天按不同 batch 计数，而不是按消息行数；老账本没有 batch 仍按行算。
- **`bili_run` 是派生进程**：MCP 调用立刻返回 `{started,pid}`；真正的轮次在后台跑，报告/日志在 `out/`、`duty.log`、`runs/`。
- **Python MCP 白名单**：`BILI_MCP_TOOLS` 名单外的工具不注册，模型连名字都看不到；评论/私信再由 PreToolUse 条件放行。
- **`seen.md` 由宿主预建**：否则第一轮读判重表会报“不存在”。
- **服务器上的 `zcode-dev` 是副本**：改代码在本地 repo，改完同步；不要直接在服务器上改源码。
- **MCP 服务在 stdin 关闭时会退出**：这是预期行为；Python 子进程会被 `py.stop()` 收掉。
- **systemd 加固**：`HOME` 指到数据目录，`ReadWritePaths` 放开 `~/.zcode` 与数据目录；否则 ZCode 写不了会话/凭据。
- **无 OS 沙箱**：策略闸门能挡模型主动调用，但不是 OS 隔离；服务器上有别的秘密就上容器。

---

## 8. 工作约定

- 本地 repo 是源码真相；同步到服务器用：
  ```bash
  tar czf - zcode vendor lib prompts | ssh -i ~/.ssh/<your-key> bili@<ECS_PUBLIC_IP> \
    'rm -rf /home/bili/zcode-dev && mkdir -p /home/bili/zcode-dev && tar xzf - -C /home/bili/zcode-dev'
  ```
- 测试在服务器 Node 22 上跑；本机没有 Node。
- 不提交/推送，除非用户明确要求；按仓库约定一件事一个 PR。
- 不改 DSH 版 `index.js` / `client.js`；ZCode 版是新增 `zcode/` 子包。
- 不读/不打印凭据与 API key；只 `ls -l` 看权限。
- 正式部署前清理 `providers/` 下的多份凭据/API key 备份（`credentials.local.json`、`credentials.server-backup.json`、`provider_config.*backup`、`apikey.env`），收敛成一份 `credentials.json` + 一份 provider 文件。

### 8.1 systemd（已安装）

```bash
systemctl status bili-duty --no-pager
journalctl -u bili-duty -n 30 --no-pager
```

当前 `peakValley=true`、`collectTimes=08:30,12:30,18:30,22:30`、`perDay=20`、`maxPerRound=5`、`roundTarget=3`、`fetchPerRound=10`、`dmBatchMax=5`、`notifyEveryHours=4`；2026-11-01 的 22:30 窗口已标记为跳过（避免改配额后补跑），下一次自动轮是 2026-11-02 08:30。

### 8.2 每天看什么

- `systemctl status bili-duty --no-pager`：进程是否 active；
- `journalctl -u bili-duty -n 50 --no-pager`：调度、运行、错误；
- `out/<日期>.md`、`seen.md`、`dm-deliveries.jsonl`：日报、判重、私信回执；
- `BILI_DUTY_HOME=/home/bili/bili-duty node bin/bili-duty.mjs usage --days=3`：token 与请求数汇总（试点期间每天看）；
- 日志出现 `1113` / `Insufficient balance` / `HTTP 401` ⇒ 重新同步桌面端 `~/.zcode/v2/credentials.json`。

---

## 9. 新会话开场白

```text
你是 zcode-bili-duty MVP 的接手者。先读 docs/zcode-handoff.md，再按里面的顺序读 AGENTS.md、docs/zcode-port-plan.md、docs/zcode-spike-summary.md、zcode/ 全部、prompts/duty.md。

当前状态：核心骨架、Python MCP 工具代理、bili_run/admin_*、systemd、私信与 4h 通知窗口均已完成；全量审查 15 条已全部处理（userConfig 已桥接到 daemon/hook）；88 个单测、plugins validate、dry-run 都通过；工作树未提交。
服务器：ssh -i ~/.ssh/<your-key> bili@<ECS_PUBLIC_IP>；数据 /home/bili/bili-duty；开发副本 /home/bili/zcode-dev/zcode；daemon PID 102847（2026-11-01 22:40 重启）。
约束：只私信、评论默认关、低频（4 次采集/天、4h 通知）；策略闸门不是 OS 沙箱；不读/不打印凭据；不提交除非我要求。
下一步：先看 2026-11-02 08:30 的自动轮与 `usage`，再继续 72h soak；之后迁移 login/setup、复核/收藏。
```

---

## 10. 参考

- [方案文档](zcode-port-plan.md)
- [Spike 汇总](zcode-spike-summary.md)
- [AGENTS.md](../AGENTS.md)
- [ZCode Plugin 文档](https://zcode.z.ai/cn/docs/plugin)
- [ZCode Hooks 文档](https://zcode.z.ai/cn/docs/hooks)
- [ZCode MCP 文档](https://zcode.z.ai/cn/docs/mcp-services)
