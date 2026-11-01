import { existsSync } from 'node:fs'
import { checkCredentials } from './credentials.mjs'
import { loadProvider } from './provider.mjs'
import { countPickedToday, autoPickedToday, picksLeftToday } from './quota.mjs'
import { readState } from './state.mjs'
import { dayKey, inWindow, WINDOWS } from './time.mjs'
import { resolveZcode } from './runner.mjs'
import { lockInfo, pidAlive } from './lock.mjs'

export function buildStatus(paths, config, now = new Date()) {
  const today = dayKey(now, config.timeZone)
  const lock = lockInfo(paths.runLock)
  const running = Boolean(lock && Number(lock.pid) > 0 && pidAlive(Number(lock.pid)))
  return {
    ok: true,
    home: paths.home,
    today,
    timeZone: config.timeZone,
    windows: Object.fromEntries(Object.entries(WINDOWS).map(([key, win]) => [key, {
      label: win.label,
      start: win.start,
      end: win.end,
      switchOn: Boolean(config[key]),
      opening: inWindow(now, win, config.timeZone),
    }])),
    quota: {
      perDay: config.perDay,
      picked: countPickedToday(paths, config, now),
      autoPicked: autoPickedToday(paths, config, now),
      left: picksLeftToday(paths, config, now),
    },
    running,
    runningSince: running ? Number(lock.ts) || 0 : 0,
    state: readState(paths),
    credentials: checkCredentials(config.credentialsFile),
    providerFile: config.providerConfigFile,
    provider: loadProvider(config.providerConfigFile),
    venv: existsSync(paths.venvPython),
    zcode: resolveZcode(config),
    dm: { mode: config.dmMode, uid: config.dmUid, watch: config.dmWatch, watchMinutes: config.dmWatchMinutes },
    reportLevel: config.reportLevel,
    report: `${paths.outDir}/${today}.md`,
  }
}
