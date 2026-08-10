import type { PluginModel } from '../model.js'
import type { FileSet } from '../fileset.js'

export type SupportLevel = 'full' | 'partial' | 'none'

export interface ComponentSupport {
  skills: SupportLevel
  commands: SupportLevel
  agents: SupportLevel
  hooks: SupportLevel
  mcp: SupportLevel
  bootstrap: SupportLevel
}

export interface EmitResult {
  files: FileSet
  warnings: string[]
}

export interface HarnessAdapter {
  name: string
  support: ComponentSupport
  emit(model: PluginModel): EmitResult
}
