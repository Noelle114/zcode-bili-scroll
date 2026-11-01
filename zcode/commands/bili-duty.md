---
description: 查看刷B站状态；手动跑一轮（MVP 阶段通过 bili-duty run）
argument-hint: "[status|run]"
---

用户想了解「刷B站」当前状态，或想手动跑一轮。

1. 先调用 `bili_status` 查看登录、配额、provider 和运行状态。
2. 如果用户要跑一轮：
   - MVP 阶段还没有 `bili_run` 工具时，告诉用户在服务器上执行：
     `BILI_DUTY_HOME=/home/bili/bili-duty /opt/bili-duty/bin/bili-duty.mjs run --manual`
   - 如果 `bili_run` 工具已经接入，则调用它，并告诉用户报告会写到 `out/<日期>.md`。
3. 不要在这个命令里发评论或私信；投递由值班轮按配置执行。
