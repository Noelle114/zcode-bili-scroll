---
description: 查看刷B站状态；手动跑一轮
argument-hint: "[status|run]"
---

用户想了解「刷B站」当前状态，或想手动跑一轮。

1. 先调用 `bili_status` 查看登录、配额、provider 和运行状态。
2. 如果用户要跑一轮：
   - 先调用 `bili_run`（已接入）；它会在后台起一轮，报告写到 `out/<日期>.md`。
   - 只有当宿主没给 `bili_run` 时，才让用户在服务器上执行：
     `BILI_DUTY_HOME=/home/bili/bili-duty node /home/bili/zcode-dev/zcode/bin/bili-duty.mjs run`
3. 不要在这个命令里发评论或私信；投递由值班轮按配置执行。
