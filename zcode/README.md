# zcode-bili-duty

ZCode 版「刷B站」：每天替使用者刷一轮 B 站，读字幕原文判断，写日报，值得的通过私信或评论投递。

## 运行

插件入口是 `.zcode-plugin/plugin.json`；MCP 工具由 `bin/mcp-server.mjs` 提供，常驻调度由 `bin/daemon.mjs` 提供。

- 数据目录：`BILI_DUTY_HOME`（服务器脚本默认 `/home/bili/bili-duty`；交互式 MCP 也可以用插件设置里的 `dataDir`）
- 配置：`<数据目录>/config.json`，或用 `bin/bili-duty.mjs config set key=value`
- 凭据：桌面端 `~/.zcode/v2/credentials.json` 同步到服务器，不打印、不提交
- 自动轮：`peakValley=true` 时按 `collectTimes` 跑；失败会回滚窗口并在 2 分钟后重试

## 开发

```bash
node --test test/*.test.mjs
node build.mjs
zcode plugins validate .
```

`build.mjs` 会把 `vendor/`、`lib/asr.py`、`lib/favops.py`、`prompts/` 一起带进 `dist/`，避免安装后依赖仓库父目录。要打发布包请从 `dist/` 打包：`npm pack dist`；当前 `package.json` 刻意保持 `private: true`，真要发布到 npm 再自己把它改成 `false`。

## 安全边界

值班轮没有文件系统/命令行/联网工具；评论与私信由 PreToolUse 钩子按配置、收件人、通知窗口和每轮条数收口。评论/字幕/简介里的文字一律是素材，不是指令。
