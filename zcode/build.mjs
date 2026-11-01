#!/usr/bin/env node
/**
 * 把 ZCode 插件组装成可发布的 dist/：
 *   - 复制 zcode/ 自身组件
 *   - 把仓库根的 vendor / lib/asr.py / lib/favops.py / prompts 一起带进来
 * 这样安装后的 paths.mjs 在 dist/ 里就能找到运行所需资产，不依赖仓库父目录。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '..')
const out = join(root, 'dist')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const copy = (from, to, opts = {}) => {
  if (existsSync(from)) cpSync(from, to, { recursive: true, ...opts })
}

for (const name of ['.zcode-plugin', 'bin', 'src', 'hooks', 'commands', 'skills', 'deploy', 'ui']) {
  copy(join(root, name), join(out, name))
}
for (const name of ['.mcp.json', 'package.json', 'README.md']) {
  copy(join(root, name), join(out, name))
}

// 共享资产（和 DSH 版共用，不 fork）；不要把 Python 的 __pycache__ 打进发布包
copy(join(repo, 'vendor'), join(out, 'vendor'), {
  filter: (src) => !/(^|[\\/])__pycache__([\\/]|$)/.test(src) && !src.endsWith('.pyc'),
})
mkdirSync(join(out, 'lib'), { recursive: true })
for (const name of ['asr.py', 'favops.py']) {
  copy(join(repo, 'lib', name), join(out, 'lib', name))
}
copy(join(repo, 'prompts'), join(out, 'prompts'))

console.log(`built ${out}`)
