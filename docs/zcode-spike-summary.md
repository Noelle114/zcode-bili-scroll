# ZCode 版「刷B站」Spike 测试汇总

> 日期：2026-11-01
> 环境：阿里云杭州 ECS · Ubuntu 22.04.5 LTS x86_64 · 2 vCPU / 3.6GB RAM / 40GB SSD
> 目的：在写 MVP 之前，验证 ZCode 路线的可行性、关键限制和部署前提
> 结论：**核心 spike 全部通过，可以进入 MVP；但有两个必须写进部署方案的约束（桌面端凭据同步、OpenAI 兼容端点）**

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| B 站读接口能否从阿里云杭州使用 | ✅ 全部可用，未触发 -412 |
| B 站私信/评论能否使用 | ✅ 私信有 `msg_key` 回执；评论可发可删 |
| ZCode headless 能否跑 | ✅ prompt 4.5–7.6 秒返回；`--resume` 正常 |
| 多 provider 能否切换 | ✅ `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` + `providerOrder` |
| 工具面能否收紧 | ✅ `PreToolUse` 允许列表 + `--disallowed-tools` |
| GLM 能否识图 | ✅ `GLM-5.3-Flash` 通过 OpenAI 兼容端点可识图，且支持工具调用 |
| systemd 能否常驻 | ✅ 启动、重启、加固参数、ZCode 调用均正常 |
| 能否直接 `zcode login` 后使用 | ❌ 服务器 OAuth 登录得到 1113；必须同步桌面端 `credentials.json` |
| 能否直接依赖 `defaultModelSelection` | ❌ 会被忽略；实际 provider 由 `providerOrder` 第一位决定 |

---

## 1. 环境清单

| 组件 | 版本 / 说明 |
|---|---|
| OS | Ubuntu 22.04.5 LTS，x86_64 |
| CPU / 内存 / 磁盘 | 2 vCPU / 3.6GB / 40GB（35GB 可用） |
| 时区 | Asia/Shanghai（已确认） |
| Node | v22.23.4 |
| npm | 10.9.9 |
| ZCode CLI | npm 包 3.16.6；CLI 本体 0.17.0 |
| Python | 3.12.16（uv 创建 venv） |
| Python 依赖 | `bilibili-api-python 17.4.2`、`aiohttp 3.14.5`、`mcp 1.30.0`、`qrcode 8.2`、`Pillow 13.0.0` |
| uv | 0.13.6 |
| 数据目录 | `/home/bili/bili-duty` |
| 测试脚本 | `/home/bili/spike-notes` |

---

## 2. 测试矩阵

| ID | 测试 | 状态 | 关键证据 |
|---|---|---|---|
| S0 | B 站只读接口 | ✅ | 搜索/视频/字幕/评论/弹幕/封面全部 OK；无 -412 |
| S0b | 私信 + 评论写操作 | ✅ | 私信有 `msg_key`；评论 rpid 已删除 |
| S1 | ZCode headless prompt | ✅ | `response="ok"`；6.06 秒；sessionId 正常 |
| S1b | 多 provider 切换 | ✅ | `model_usage` 确认实际 provider/model |
| S2 | 工具白名单 | ✅ | Bash 被 hook 拒绝；Read 白名单通过 |
| S3 | 图片输入/视觉 | ✅ | GLM-5.3-Flash 正确识别测试图 |
| S5 | systemd 常驻 | ✅ | 启动/重启/ZCode 调用/加固全部通过 |
| S7 | 真实一轮性能 | ⏳ | 需 MVP 接入章程后再测 |
| S8 | 章程质量 | ⏳ | 需 MVP 接入章程后再测 |

---

## 3. 详细结果

### S0 · B 站只读

测试账号 UID：`<TEST_UID>`（小号；真实值不写入公开仓库）。

| 接口 | 结果 | 耗时 |
|---|---|---|
| `user_info`（登录态） | OK | 704ms |
| `search`（关键词 DeepSeek，按最新） | OK | 493ms |
| `video_info` × 3 | OK | 52 / 61 / 53ms |
| `subtitle` × 3 | OK | 71 / 95 / 86ms |
| `comments` × 3 | OK | 110 / 74 / 69ms |
| `danmaku` × 3 | OK | 87 / 96 / 91ms |
| `cover` × 3 | OK | 166 / 126 / 36ms |

- 未出现 `-412`、验证码或限流。
- 未登录时 `subtitle` 报 `CredentialNoSessdataException`；登录后正常。
- 注意：这只是短时测试，上线前仍需按低频节奏做 72 小时 soak。

### S0b · 私信 + 评论

- 测试账号 → 主号 `<MAIN_UID>` 发一条短私信：
  - 返回 `msg_key` 投递回执；
  - 待确认：主号是否收到、是否有通知。
- 测试视频 `BV1L3411W7Sb` 发一条评论：
  - rpid `318867805297`；
  - 删除接口 `POST /x/v2/reply/del` 返回 `{"code":0,"message":"OK"}`；
  - 已删除。
- 未测：490/500/600 字符长度、连续 3 条间隔 30 秒的频率测试（按低频策略后续补）。

### S1 · ZCode headless

- 命令：
  ```bash
  zcode --prompt "只输出 ok" --cwd /home/bili/bili-duty/workspace \
        --mode yolo --output-format json
  ```
- 结果：`response="ok"`，sessionId 正常。
- 耗时：6.06–6.16 秒；峰值内存约 316MB；约 9,776 token（含系统提示/工具定义）。
- `--resume <sessionId>`：成功，沿用同一 sessionId，7.79 秒，约 330MB。
- `zcode doctor --json` 正常。

### S1b · 多 provider 切换

**核心结论：`defaultModelSelection` 会被忽略，实际 provider 由 `providerOrder` 第一位决定。**

- `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 生效。
- 实测：
  - main config = bigmodel-only → `model_usage`: `bigmodel-api / GLM-5.3`
  - main config = 本地默认（zai 第一），env 指向 bigmodel-only → `model_usage`: `bigmodel-api / GLM-5.3`
  - zai 第一时 → `model_usage`: `zai-standard-api / glm-5.3-flashx`
- 结论：daemon 每次 spawn 传不同的 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`，配置文件里把目标 provider 放在 `providerOrder` 第一位。

### S2 · 工具白名单

- `PreToolUse` hook 能收到：
  - `tool_name`
  - `tool_input`
  - `cwd` = `/home/bili/bili-duty/workspace`
  - `BILI_DUTY_RUN=1`（env 继承成功）
- 拒绝 `Bash`：
  - 模型回答「不能用 Bash」；
  - `tool_usage` 记录 `Bash / error / spike: ...`。
- 白名单 `Read`：
  - `Read` 成功读取 `SPIKE_OK`；
  - `Bash` 被拒绝；
  - `tool_usage` 记录 `Read / completed`。
- `--disallowed-tools Bash`：
  - 模型直接回答「不能用 Bash」；
  - 没有 Bash 工具调用记录。
- 结论：`--disallowed-tools` + `PreToolUse` 双层收口可行。

### S3 · 图片输入（修正版）

测试图：640×320 PNG，红色圆形 + 蓝色矩形 + 文字 `VISION_OK_7342`。

| Provider / 模型 | 端点 | 结果 |
|---|---|---|
| `bigmodel-api / GLM-5.3`（内置） | `anthropic-messages` | ❌ 模型只拿到 OSS 链接，看不到像素 |
| `bigmodel-flash-openai / GLM-5.3-Flash`（自定义） | `openai-chat-completions`，`https://open.bigmodel.cn/api/paas/v4` | ✅ 正确识别；10,166 input / 163 output |
| `zai-flash / GLM-5.3-Flash`（自定义） | `openai-chat-completions`，`https://api.z.ai/api/paas/v4` | ✅ 正确识别；10,164 input / 140 output |

模型回答：

> 左侧：红色实心圆形；右侧：蓝色边框的空心矩形；矩形内文字：`VISION_OK_7342`。

**关键修正：**

- GLM-5.3-Flash **有视觉能力**；
- 必须用 `openai-chat-completions` 端点；`anthropic-messages` 不会传图片像素；
- 必须用**自定义 provider ID** 才能强制指定模型；内置 provider ID 会忽略自定义 model 列表；
- 同一个 `GLM-5.3-Flash` 也支持工具调用：`Read` 成功读取 `SPIKE_OK`，`tool_usage` 记录 `Read / completed`。

### S5 · systemd 常驻

- 最小 Node daemon + systemd unit：
  - `User=bili`、`Group=bili`
  - `Environment=HOME=/home/bili`
  - `Environment=BILI_DUTY_HOME=/home/bili/bili-duty`
  - `Environment=BILI_DUTY_TZ=Asia/Shanghai`
  - `Restart=always`、`RestartSec=5`
  - `NoNewPrivileges=true`、`PrivateTmp=true`、`ProtectSystem=strict`、`ProtectHome=read-only`
  - `ReadWritePaths=/home/bili/.zcode /home/bili/bili-duty`
- 结果：
  - systemd 启动成功（PID 37464），空闲内存约 684KB；
  - daemon 内 ZCode 调用成功：`exit=0`、`response="ok"`；
  - `systemctl restart` 成功：PID 37464 → 37967；
  - 加固参数未阻断 ZCode；
  - 测试服务已 stop/disable/移除，unit 保留在 `/home/bili/spike-notes/bili-duty-test.service`。

---

## 4. 关键发现（会改方案）

### 4.1 服务器必须使用桌面端的 `credentials.json`

- 只在服务器上 `zcode login zai/bigmodel`：所有 provider/模型都返回 `1113 Insufficient balance or no resource package`。
- 把本机 ZCode 桌面端的 `~/.zcode/v2/credentials.json` 同步到服务器后，立即恢复。
- 差异：本机凭据包含 `zcodejwttoken` + non-team `project-key-location`；服务器 OAuth 登录创建的是不同的 project 上下文。
- **部署必须加一步「同步桌面端凭据」**；token 过期后需要重新同步。
- daemon 需要识别 `1113` / 鉴权失败，并提示用户重新同步。

### 4.2 provider 由 `providerOrder` 决定

- `defaultModelSelection` 被忽略。
- `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 生效。
- 每个 provider 一份配置文件，`providerOrder` 只放目标 provider（或把它放第一位）。

### 4.3 视觉/工具必须用 OpenAI 兼容端点

- `GLM-5.3-Flash` 同时支持文本、工具调用、图片；
- 端点必须是 `openai-chat-completions`；
- BigModel 的 `anthropic-messages` 端点不会传图片像素；
- 必须用自定义 provider ID 强制模型。

### 4.4 推荐 provider 配置

`/home/bili/bili-duty/providers/provider.recommended.json`：

```json
{
  "providerOrder": ["bigmodel-flash-openai"],
  "providerConfigRules": {
    "providerRules": [{
      "providerId": "bigmodel-flash-openai",
      "providerName": "BigModel GLM-5.3-Flash (OpenAI API)",
      "config": {
        "group": "standard-personal",
        "personalModelIds": ["GLM-5.3-Flash"],
        "modelOrder": ["GLM-5.3-Flash"],
        "access": { "type": "api-key", "apiKey": "***" },
        "api": {
          "type": "openai-chat-completions",
          "baseUrl": "https://open.bigmodel.cn/api/paas/v4"
        }
      }
    }]
  }
}
```

使用方式：

```bash
ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=/home/bili/bili-duty/providers/provider.recommended.json \
zcode --prompt "..." --cwd /home/bili/bili-duty/workspace --mode yolo
```

---

## 5. 性能

| 场景 | 耗时 | token / 内存 |
|---|---|---|
| 纯文本 prompt | 4.5–7.6 秒 | ~9.9k input；峰值 316MB |
| 一次 Read 工具调用 | 约 5 秒总耗时；Read 本身 110–120ms | ~19.8k total（2 次模型请求） |
| 带图识图 | 7.6 秒 | 10,166 input / 163 output |
| `--resume` | 7.79 秒 | ~330MB |
| systemd 空闲 daemon | — | 约 684KB（systemd 报告） |

真实值班轮（8 条视频、字幕、评论）预计 **5–15 分钟**，主要花在模型和 B 站接口。S7 会在 MVP 后用真实章程再测。

---

## 6. 风险与未完成项

| 项 | 状态 | 说明 |
|---|---|---|
| 桌面端凭据过期 | 未验证 | 需要观察有效期；daemon 要能识别 1113 并提示重新同步 |
| 72 小时低频 soak | 未做 | 云 IP 风控需要长期低频验证，不能只凭短时测试 |
| S7 真实一轮性能 | 未做 | 需要 MVP 的章程 + MCP + 真实工具调用 |
| S8 章程质量 | 未做 | 需要看 GLM-5.3-Flash 在真实章程下的判断/写作质量 |
| 无 OS 沙箱 | 已知 | ZCode 只能做策略闸门；如需强隔离要上容器 |
| ZCode API 变动 | 已知 | 工具名、hook 字段、provider 配置可能随版本变化 |
| Web UI | 未做 | 当前是 CLI/服务端；是否需要本地 Web 面板待定 |

---

## 7. MVP 建议

### 7.1 范围（建议）

1. `zcode/` 插件骨架：`.zcode-plugin/plugin.json`、`.mcp.json`、`hooks/hooks.json`、`skills/`、`commands/`；
2. Node 控制面 MCP 服务：配置/状态/运行/登录/安装/状态；
3. Python MCP（B 站读取 + `duty_*`）作为子进程；
4. 推荐 provider 配置 + 凭据同步步骤；
5. `PreToolUse` 允许列表；
6. `bili-duty run` 手动跑一轮，写报告；
7. systemd daemon 骨架（先不做复杂调度）；
8. 私信投递一条（可先手动触发）。

### 7.2 暂缓

- Web UI 面板；
- 自动 tick / 谷时调度；
- 自动收藏、评论复核、私信双向；
- 多 provider 自动故障转移；
- 72 小时 soak（上线前再做）。

### 7.3 需要拍板的决策

1. **主 provider**：推荐 `bigmodel-flash-openai / GLM-5.3-Flash`（文本+工具+图片一个模型）；Z.AI 标准 API 作为备选。
2. **凭据刷新**：手动同步 `credentials.json`，还是做一个 `bili-duty sync-credentials` 命令/说明？
3. **MVP 范围**：只做手动跑一轮 + 报告，还是同时做 systemd 定时 + 私信？
4. **Web UI**：CLI 够不够，还是需要本地 Web 面板（SSH 隧道访问）？
5. **视觉**：默认开启图片判断，还是先只读字幕、图片作为可选？

---

## 附录 · 测试产物

服务器 `/home/bili/spike-notes/`：

- `S0-report.md`
- `S0b-report.md`
- `S1-S2-report.md`
- `S3-report.md`
- `S5-report.md`
- `SPIKE-SUMMARY.md`（本文件）
- `vision-test.png`
- `login_qr.py` / `login_node.mjs`
- `daemon-test.mjs` / `bili-duty-test.service`
- `s0_read.py` / `s0b_write.py`

关键配置：

- `/home/bili/bili-duty/providers/provider.recommended.json`
- `/home/bili/bili-duty/providers/provider.vision.json`
- `/home/bili/bili-duty/providers/provider.bigmodel-only.json`
- `/home/bili/bili-duty/providers/provider.zai-flash-custom.json`

> 本文不包含任何 token、cookie、API key 或凭据原文。
