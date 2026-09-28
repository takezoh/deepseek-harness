import { existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

const REPOSITORY_ROOT = import.meta.dirname

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Whether a directory is a live workspace package, marked by its package.json. */
function isLivePackage(directory: string): boolean {
  return existsSync(join(directory, 'package.json'))
}

/** Direct child directories of one base directory, as repository-relative POSIX paths. */
function childDirectories(base: string): string[] {
  return readdirSync(join(REPOSITORY_ROOT, base), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(REPOSITORY_ROOT, base, entry.name))
    .map(directory => relative(REPOSITORY_ROOT, directory).split(sep).join('/'))
    .sort()
}

/** Live package directories directly under one base directory, as repository-relative POSIX paths. */
function childPackages(base: string): string[] {
  return childDirectories(base).filter(directory => isLivePackage(join(REPOSITORY_ROOT, directory)))
}

/** Live two-level package directories (for example packages/<group>/<package>) under one base. */
function groupedPackages(base: string): string[] {
  return childDirectories(base).flatMap(group => childPackages(group))
}

/**
 * Directory list for the tsdown workspace.
 *
 * tsdown's workspace option accepts directory globs, which would also match a
 * manifest-less directory left behind by an in-place update that deleted a
 * package: its untracked lib/types entry would then be built from stale imports
 * and fail. Selecting only directories with a package.json keeps the workspace
 * aligned with `scripts/clean.ts`, which treats the manifest as the live-package
 * marker.
 */
function workspaceDirectories(client: boolean): string[] {
  const directories = [...childPackages('vendor'), ...groupedPackages('packages')]
  for (const app of childPackages('apps')) {
    if (app === 'apps/cli' || (app === 'apps/desktop-host' && !client)) directories.push(app)
  }
  return directories
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact. `apps/desktop` bundles after
 * this pass (root package.json `build:lib:host`): its main bundle inlines
 * workspace devDependencies from their lib/ output, and tsdown builds
 * workspace members concurrently without ordering them.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: { include: workspaceDirectories(client) },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
