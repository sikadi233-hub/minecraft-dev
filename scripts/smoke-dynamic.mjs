// Live smoke: resolve three versions that are NOT in the pinned matrix, against
// the real metadata endpoints (network required).
import { resolveDynamic } from '../lib/dynamic-versions.js'

const cases = [
  ['paper', '1.21.4'],
  ['paper', '1.20.4'],
  ['fabric', '1.21.4'],
  ['neoforge', '1.21.4'],
  ['neoforge', '26.3'],
]

for (const [platform, version] of cases) {
  try {
    const result = await resolveDynamic({ platform, minecraftVersion: version })
    console.log(`  ${platform} ${version}: template=${result.templateDir} java=${result.javaVersion} coords=${JSON.stringify(result.coords)}`)
  } catch (error) {
    console.log(`  ${platform} ${version}: FAILED ${error.message}`)
  }
}
