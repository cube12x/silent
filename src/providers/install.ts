import type { InstallMethod } from "@/domain"
import type { Platform } from "@/lib/platform"
import type { ProviderInfo } from "./registry"

export interface InstallOption {
  method: InstallMethod
  command: string
}

/**
 * Install commands Silent may run for a CLI on this platform. `curl … | bash` scripts never run on
 * Windows; a CLI with no npm package there is installed by hand (docs link).
 */
export function installOptions(info: Pick<ProviderInfo, "installScript" | "installNpm">, platform: Platform): InstallOption[] {
  const out: InstallOption[] = []
  if (platform === "windows") {
    if (info.installNpm) out.push({ method: "npm", command: info.installNpm })
    return out
  }
  if (info.installScript) out.push({ method: "script", command: info.installScript })
  if (info.installNpm && info.installNpm !== info.installScript) out.push({ method: "npm", command: info.installNpm })
  return out
}

/** npm's classic "EACCES: permission denied" when Node came from the nodejs.org installer. */
export function looksLikeNpmPermissionError(logText: string): boolean {
  return /EACCES|permission denied.*npm|npm ERR!.*mkdir/i.test(logText)
}
