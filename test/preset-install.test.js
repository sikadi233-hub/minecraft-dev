import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMPOSITION_FILE,
  PRESET_ID,
  USER_PRESET_DIR,
  ensurePresetInstalled,
  resolveDshHome,
} from '../lib/preset-install.js'

/** A fake package preset source with the two shipped files. */
async function makeSource() {
  const dir = await mkdtemp(join(tmpdir(), 'mc-preset-src-'))
  await writeFile(join(dir, 'preset.yml'), 'displayName: Minecraft Expert\n')
  await writeFile(join(dir, 'agent.cordis.yml'), '- name: dsh-base\n')
  return dir
}

test('installs the preset into <home>/.agent-presets/minecraft when absent', async () => {
  const src = await makeSource()
  const home = await mkdtemp(join(tmpdir(), 'mc-preset-home-'))
  try {
    const result = await ensurePresetInstalled({ srcDir: src, home })
    assert.equal(result.installed, true)
    assert.equal(result.destDir, join(home, USER_PRESET_DIR, PRESET_ID))
    assert.deepEqual(result.written.sort(), ['agent.cordis.yml', 'preset.yml'])
    assert.equal(
      await readFile(join(home, USER_PRESET_DIR, PRESET_ID, 'preset.yml'), 'utf8'),
      'displayName: Minecraft Expert\n',
    )
    assert.equal(
      await readFile(join(home, USER_PRESET_DIR, PRESET_ID, COMPOSITION_FILE), 'utf8'),
      '- name: dsh-base\n',
    )
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test('skips when a composition already exists and never clobbers it', async () => {
  const src = await makeSource()
  const home = await mkdtemp(join(tmpdir(), 'mc-preset-home-'))
  const destDir = join(home, USER_PRESET_DIR, PRESET_ID)
  await mkdir(destDir, { recursive: true })
  await writeFile(join(destDir, COMPOSITION_FILE), '- name: user-custom\n')
  try {
    const result = await ensurePresetInstalled({ srcDir: src, home })
    assert.equal(result.installed, false)
    assert.equal(result.reason, 'exists')
    // the user composition is untouched…
    assert.equal(await readFile(join(destDir, COMPOSITION_FILE), 'utf8'), '- name: user-custom\n')
    // …and none of the shipped files leaked in either
    await assert.rejects(readFile(join(destDir, 'preset.yml'), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test('heals a broken preset directory whose composition file is missing', async () => {
  const src = await makeSource()
  const home = await mkdtemp(join(tmpdir(), 'mc-preset-home-'))
  const destDir = join(home, USER_PRESET_DIR, PRESET_ID)
  await mkdir(destDir, { recursive: true })
  await writeFile(join(destDir, 'leftover.txt'), 'junk')
  try {
    const result = await ensurePresetInstalled({ srcDir: src, home })
    assert.equal(result.installed, true)
    assert.equal(await readFile(join(destDir, COMPOSITION_FILE), 'utf8'), '- name: dsh-base\n')
    assert.equal(await readFile(join(destDir, 'preset.yml'), 'utf8'), 'displayName: Minecraft Expert\n')
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test('resolveDshHome honors DSH_HOME, tilde expansion and the ~/.dsh fallback', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'C:\\Custom\\Home' }), 'C:\\Custom\\Home')
  assert.equal(resolveDshHome({ DSH_HOME: '~/mc-home' }), join(homedir(), 'mc-home'))
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
})
