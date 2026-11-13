import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import { PiAiAdapter } from './adapter.ts'
import { resolveProfiles } from './config.ts'
import { credentialStoreFrom, authContextFrom } from './auth.ts'

interface Model { id: string; name: string; provider: string; maxOutput: number; vision: boolean; currency: 'USD' | 'CNY'; prices: Record<string, string> }
interface Bridge { url: string; token: string }
const retry: ResolvedRetryPolicy = { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 }

export class BambooAdapter extends LlmAdapter {
  private adapter: PiAiAdapter | undefined
  private models: Model[] = []
  private fingerprint = ''
  private loading: Promise<void> | undefined

  constructor(private readonly ctx: Context, private readonly bridge: Bridge) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Bamboo' } }
  override providerRetryPolicy() { return retry }

  async load(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.loading) return this.loading
    this.loading = (async () => {
      let response: Response
      try {
        response = await fetch(this.bridge.url + '/catalog', { redirect: 'error',
          headers: { authorization: `Bearer ${this.bridge.token}` }, signal: AbortSignal.timeout(20_000) })
      } catch { throw new LlmError('Bamboo account is unavailable. Open Settings → Bamboo account and refresh.', 'TRANSPORT') }
      if (!response.ok) throw new LlmError('Bamboo account could not be loaded. Open Settings → Bamboo account and refresh.', 'TRANSPORT')
      const catalog = await response.json() as { generation: number; models: Model[] }
      if (!Number.isSafeInteger(catalog.generation) || !Array.isArray(catalog.models)) throw new LlmError('Bamboo returned an invalid model catalog.', 'CONFIG')
      const fingerprint = JSON.stringify(catalog)
      if (fingerprint !== this.fingerprint) {
        this.models = catalog.models
        this.fingerprint = fingerprint
        if (catalog.models.length === 0) this.adapter = undefined
        else {
          const profiles = resolveProfiles({ bamboo: {
            displayName: 'Bamboo', api: 'openai-completions', apiKeyEnv: 'BAMBOO_PRIVATE_PROXY',
            baseURL: `${this.bridge.url}/session/${catalog.generation}/v1`,
            defaultContextWindow: 32768, retryPolicy: { mode: 'normal', maxRetries: 0 },
            compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
              supportsUsageInStreaming: true, supportsStrictMode: false, maxTokensField: 'max_tokens',
              requiresReasoningContentOnAssistantMessages: true },
            models: catalog.models.map(model => ({ id: model.id, name: model.name, maxTokens: model.maxOutput,
              input: model.vision ? ['text', 'image'] : ['text'], reasoningEfforts: false })),
          } })
          this.adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => this.bridge.token,
            auth: { credentials: credentialStoreFrom(this.ctx), authContext: authContextFrom(this.ctx) },
            resolveAttachments: () => this.ctx.get('attachments'),
            resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
              hostPath => this.ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
          })
        }
      }
      const defaults = this.ctx.get('agentDefaultModel') as {
        currentSelection(): { provider: string; model: string }
        saveSelection(selection: { provider: string; model: string }): Promise<void>
      } | undefined
      const first = this.models[0]
      if (defaults && first) {
        const current = defaults.currentSelection()
        if (current.provider !== 'bamboo' || !this.models.some(model => model.id === current.model)) {
          await defaults.saveSelection({ provider: 'bamboo', model: first.id })
        }
      }
    })().finally(() => { this.loading = undefined })
    await this.loading
    signal?.throwIfAborted()
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.load()
    return this.models.map(model => ({ provider, id: model.id, name: model.name,
      inputModalities: model.vision ? ['text', 'image'] : ['text'],
      description: `${model.provider}${model.prices.input !== undefined && model.prices.output !== undefined
        ? ` · ${model.currency} ${model.prices.input} input / ${model.currency} ${model.prices.output} output per 1M tokens` : ''}` }))
  }

  private configured(model: string): PiAiAdapter {
    if (!this.adapter || !this.models.some(item => item.id === model)) {
      throw new LlmError('Sign in to Bamboo and choose an available model. Open Settings → Bamboo account to refresh.', 'MISSING_CREDENTIAL')
    }
    return this.adapter
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    await this.load(signal)
    return this.configured(model).resolveModel(provider, model, signal)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.load(signal)
    return this.configured(model).prepareCall(provider, model, signal)
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) {
    return this.adapter?.imageRequestTarget(provider, model, image) ?? super.imageRequestTarget(provider, model, image)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.load(options.signal)
    yield* this.configured(options.model).stream(options)
  }
}

export function applyBamboo(ctx: Context): boolean {
  const bridge = Reflect.get(globalThis, Symbol.for('bamboo.desktop.bridge')) as Bridge | undefined
  if (!bridge) return false
  const adapter = new BambooAdapter(ctx, bridge)
  ctx.llm.registerAdapter(['bamboo'], adapter)
  return true
}
