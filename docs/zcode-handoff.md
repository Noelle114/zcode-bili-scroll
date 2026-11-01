# ZCode 版「刷B站」交接文档

> 日期：2026-11-01
> 用途：新会话接手 `zcode-bili-duty` MVP
> 原则：本文只写「读什么、服务器是什么状态、已做什么、下一步」；细节以链接文件为准。
> ⚠️ 仓库是公开的：本文里的服务器 IP / UID 用占位符；真实值见服务器或本地笔记，不要提交。

---

## 0. 一句话状态（2026-11-01 17:05 CST 更新）

- 方案已定稿，并已合入 spike 实测发现：[zcode-port-plan.md](zcode-port-plan.md)。
- `zcode/` 子包已完成核心骨架、Python MCP 工具代理、`bili_run` / `admin_*`；**22 个单测**、`zcode plugins validate` 通过。
- 已在 `feat/zcode-mvp` 提交 `e447a23`；本地另有 **5 个未提交修复**：`zcode/.mcp.json`、`zcode/bin/mcp-server.mjs`、`zcode/src/credentials.mjs`、`zcode/src/runner.mjs`、`zcode/test/credentials.test.mjs`。
- **真实一轮已跑通**（2026-11-01 17:02–17:05 CST）：只挑 1 条 `BV1JPx16tEWG`，日报 `out/2026-11-01.md`（2825 字节），`seen.md` 4 行，`digest/2026-11.md` 已写；**未发评论、未发私信**；耗时 187 秒。
- 修了两个真 bug：
  1. **ZCode 要求声明了 outputSchema 的 MCP 工具返回 structuredContent**，而 Python MCP 返回纯文本 ⇒ 在 `bin/mcp-server.mjs` 代理层去掉 `outputSchema`，并在结果里补 `structuredContent`；
  2. **`isAuthError` 把 stream 里的 `seq:1113` 当成鉴权失败** ⇒ 只检查结构化错误事件，并把正则收紧到 `code/status/error/message` 上下文。
- 服务器当前状态：插件以 **inline** 方式挂在 `~/.zcode/cli/config.json` 的 `plugins.dirs`（原配置备份在 `/home/bili/bili-duty/runs/zcode-cli-config.bak-*`）；测试配置为 `perDay=1 / dmMode=off / autoComment=false / dmWatch=false`，**接私信前要改回 `dmMode=only` 并填 `dmUid`**。
- 下一步：systemd 调度 + 4h 通知；恢复投递配置；迁移 login/setup；复核/收藏/笔记/判重滚动。

---

## 1. 必读文件（按顺序）

| 顺序 | 文件 | 为什么 |
|---|---|---|
| 1 | [AGENTS.md](../AGENTS.md) | 仓库约定、DSH 版背景、安装/发版规矩 |
| 2 | [docs/zcode-port-plan.md](zcode-port-plan.md) | 主方案：架构、目录、模块边界、接口、任务、风险、部署。**读全文**；重点 §0 / §0.1 / §3 / §4 / §5 / §6.3.4 / §10–§16 |
| 3 | [docs/zcode-spike-summary.md](zcode-spike-summary.md) | spike 实测结论：凭据同步、providerOrder、OpenAI 端点、systemd、私信 |
| 4 | [zcode/](../zcode) 全部 | 当前实现（36 个文件）：`bin/`、`src/`、`hooks/`、`test/`、`skills/`、`commands/`、`.zcode-plugin/plugin.json`、`.mcp.json` |
| 5 | [prompts/duty.md](../prompts/duty.md) | 值班章程原文；`zcode/skills/bili-duty/SKILL.md` 是它的副本 |

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

- 单测 **20/20 通过**：`cd /home/bili/zcode-dev/zcode && node --test test/*.test.mjs`
- `zcode plugins validate /home/bili/zcode-dev/zcode --json` → `ok: true`
- MCP `tools/list` → 28 个工具
- `bili_search` 代理成功（真实搜索结果）
- `duty_paths` / `duty_seen_recent` 正常
- `bili_cover` 返回 `["text","image"]`，图片块透传成功
- `bili_run {"dryRun":true}` → 派生进程成功，后台 7.4 秒完成，`ok: true`、provider 正确、sessionId 正常
- MCP 在 stdin 关闭后优雅退出（exit 0），Python 子进程会被收掉
- `bili-duty status` / `provider check` / `doctor` 全绿

---

## 6. 未完成 / 下一步

按优先级：

1. **真实一轮**：在服务器上跑 `bili-duty run --manual`（先确认 `dmMode=only` 且 `dmUid` 是否填；没填就不会发私信），检查 `out/<日期>.md`、`seen.md`、`duty.log`。
2. **systemd 调度**：daemon 内 tick + 4h 通知窗口；低频（2 次采集/天）。
3. **私信发送**：把一轮挑中的结果发一条到主号；确认 500 字上限。
4. **login / setup 迁移**：把 spike 的 `login_qr.py` 和 uv/venv 安装逻辑搬进 `src/login.mjs` / `src/install.mjs`。
5. **复核 / 收藏 / 笔记 / 判重滚动**：参考 `lib/verify.mjs`、`lib/favops.py`、`index.js` 对应段。
6. **build / 部署包**：`build.mjs`、`deploy/bili-duty.service`、`DEPLOY-UBUNTU.md`。
7. **上线前**：72h 低频 soak、S7 真实性能、S8 章程质量。

---

## 7. 已知坑

- **服务器不能独立 OAuth**：`zcode login` 会 1113；必须同步桌面端 `~/.zcode/v2/credentials.json`；过期后要重新同步。
- **provider 由 `providerOrder` 第一位决定**：`defaultModelSelection` 会被忽略；每次 spawn 用 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指定文件。
- **视觉必须 `openai-chat-completions` + 自定义 provider ID**：`anthropic-messages` 只给 OSS 链接、看不到像素。
- **`isAuthError` 不要匹配裸 `401`**：事件 UUID 里可能含 `401`，会误报；只认 `1113` / `HTTP 401` / `status:401` 等高信号。
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

---

## 9. 新会话开场白

```text
你是 zcode-bili-duty MVP 的接手者。先读 docs/zcode-handoff.md，再按里面的顺序读 AGENTS.md、docs/zcode-port-plan.md、docs/zcode-spike-summary.md、zcode/ 全部、prompts/duty.md。

当前状态：核心骨架、Python MCP 工具代理、bili_run/admin_* 已完成；20 个单测、plugins validate、dry-run 都通过；未提交。
服务器：ssh -i ~/.ssh/<your-key> bili@<ECS_PUBLIC_IP>；数据 /home/bili/bili-duty；开发副本 /home/bili/zcode-dev/zcode。
约束：只私信、评论默认关、低频（2 次采集/天、4h 通知）；策略闸门不是 OS 沙箱；不读/不打印凭据；不提交除非我要求。
下一步：先在服务器上跑一轮真实值班（只写报告、不发评论/私信），然后接 systemd 调度和 4h 通知。
```

---

## 10. 参考

- [方案文档](zcode-port-plan.md)
- [Spike 汇总](zcode-spike-summary.md)
- [AGENTS.md](../AGENTS.md)
- [ZCode Plugin 文档](https://zcode.z.ai/cn/docs/plugin)
- [ZCode Hooks 文档](https://zcode.z.ai/cn/docs/hooks)
- [ZCode MCP 文档](https://zcode.z.ai/cn/docs/mcp-services)
