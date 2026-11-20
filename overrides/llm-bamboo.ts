import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, ProviderRequestId, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmFailure, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import { decodeBambooFailure } from './bamboo-failure.ts'
import { PiAiAdapter } from './adapter.ts'
import { THINKING_LEVELS, type PiAiReasoningEfforts } from './catalog.ts'
import { resolveProfiles } from './config.ts'
import { credentialStoreFrom, authContextFrom } from './auth.ts'

interface Model { id: string; name: string; provider: string; vendor?: string; contextWindow: number; maxOutput: number; vision: boolean; tools: boolean; reasoningEfforts?: string[]; currency: 'USD' | 'CNY'; prices: Record<string, string> }
interface Bridge { url: string; token: string }
const accountStatuses = ['signed-out', 'connecting', 'waiting', 'signed-in'] as const
type AccountStatus = typeof accountStatuses[number]
interface Catalog { generation: number; status: AccountStatus; models: Model[]; error?: string }
const retry: ResolvedRetryPolicy = { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 }
const gatewayRefusalMessage = 'The model declined this request. Revise the message and try again.'

function reasoningProfile(efforts: readonly string[] = []): PiAiReasoningEfforts | false {
  const levels: PiAiReasoningEfforts = {}
  for (const level of THINKING_LEVELS) {
    const wire = level === 'off' ? 'none' : level
    if (efforts.includes(wire)) levels[level] = wire
  }
  return Object.keys(levels).length ? levels : false
}

function modelFailure(failure: LlmFailure, headers?: Readonly<Record<string, string>>): LlmFailure {
  const decoded = decodeBambooFailure(failure)
  const header = headers?.['x-request-id']
  const requestId = header && /^req_[a-f0-9]{32}$/.test(header) ? ProviderRequestId(header) : undefined
  if (decoded) return {
    ...failure, ...decoded,
    ...requestId === undefined ? {} : { requestId },
    message: requestId && !decoded.message.includes(requestId) ? `${decoded.message} Request ID: ${requestId}.` : decoded.message,
  }
  const refused = failure.message === gatewayRefusalMessage || failure.message === 'Provider finish_reason: content_filter'
  if (!refused && !requestId) return failure
  const message = refused ? 'The model declined this request. Try starting a new chat with a revised message.' : failure.message
  return {
    ...failure,
    code: refused ? 'UPSTREAM_REFUSED' : failure.code,
    ...requestId === undefined ? {} : { requestId },
    message: requestId && !message.includes(requestId) ? `${message} Request ID: ${requestId}.` : message,
  }
}

async function* chatStream(call: PreparedAdapterCall, options: GenerateOptions): AsyncIterable<StreamChunk> {
  if (options.tools?.some(tool => tool.name === 'exit_plan_mode')) {
    throw new LlmError('Plan mode requires a model with tool calling. Switch to Standard mode to chat.', 'UNSUPPORTED_OPTION')
  }
  if (options.messages.some(message => message.role === 'tool' || message.content.some(block => block.type === 'tool-call'))) {
    throw new LlmError('This chat contains tool activity. Start a new chat or choose a model with tool calling.', 'UNSUPPORTED_CONTENT')
  }
  const { tools, toolHistory, system, ...conversation } = options
  const chatInstructions = 'Answer conversationally using the supplied messages and attachments. Workspace tools are disabled for this model.'
  for await (const chunk of call.stream({ ...conversation, system: system ? `${system}\n\n${chatInstructions}` : chatInstructions })) {
    if (chunk.type === 'tool-call-delta' || chunk.type === 'block-start' && chunk.blockType === 'tool-call'
      || chunk.type === 'block-end' && chunk.block.type === 'tool-call' || chunk.type === 'finish' && chunk.reason.kind === 'tool-calls') {
      throw new LlmError('The model returned an unsupported tool call.', 'UNSUPPORTED_CONTENT')
    }
    yield chunk
  }
}

export class BambooAdapter extends LlmAdapter {
  private adapter: PiAiAdapter | undefined
  private models: Model[] = []
  private accountStatus: AccountStatus = 'signed-out'
  private accountError: string | undefined
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
      const catalog = await response.json() as Catalog
      if (!catalog || !Number.isSafeInteger(catalog.generation) || !accountStatuses.includes(catalog.status)
        || (catalog.error !== undefined && typeof catalog.error !== 'string') || !Array.isArray(catalog.models) || catalog.models.some(model =>
        typeof model?.tools !== 'boolean' || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)) {
        throw new LlmError('Bamboo returned an invalid model catalog.', 'CONFIG')
      }
      const fingerprint = JSON.stringify(catalog)
      if (fingerprint !== this.fingerprint) {
        if (catalog.models.length === 0) this.adapter = undefined
        else {
          const profiles = resolveProfiles({ bamboo: {
            displayName: 'Bamboo', api: 'openai-completions', apiKeyEnv: 'BAMBOO_PRIVATE_PROXY',
            baseURL: `${this.bridge.url}/session/${catalog.generation}/v1`,
            retryPolicy: { mode: 'normal', maxRetries: 0 },
            compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true,
              supportsUsageInStreaming: true, supportsStrictMode: false, maxTokensField: 'max_tokens', thinkingFormat: 'openai' },
            models: catalog.models.map(model => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxOutput,
              input: model.vision ? ['text', 'image'] : ['text'], reasoningEfforts: reasoningProfile(model.reasoningEfforts),
              compat: { requiresReasoningContentOnAssistantMessages: (model.vendor || model.provider) === 'deepseek' } })),
          } })
          this.adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => this.bridge.token,
            waitForUpstream: true,
            mapFailure: modelFailure,
            auth: { credentials: credentialStoreFrom(this.ctx), authContext: authContextFrom(this.ctx) },
            resolveAttachments: () => this.ctx.get('attachments'),
            resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
              hostPath => this.ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
          })
        }
        this.models = catalog.models
        this.accountStatus = catalog.status
        this.accountError = catalog.error
        this.fingerprint = fingerprint
      }
      const defaults = this.ctx.get('agentDefaultModel') as {
        currentSelection(): { provider: string; model: string }
        saveSelection(selection: { provider: string; model: string }): Promise<void>
      } | undefined
      const first = this.models.find(model => model.tools) ?? this.models[0]
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
    if (this.accountStatus !== 'signed-in') {
      const message = this.accountStatus === 'signed-out' ? 'Sign in to Bamboo in Settings → Bamboo account.'
        : 'Complete Bamboo sign-in in Settings → Bamboo account.'
      throw new LlmError(message, 'MISSING_CREDENTIAL')
    }
    if (!this.adapter) {
      if (this.accountError) throw new LlmError(this.accountError, 'TRANSPORT')
      throw new LlmError('Bamboo has no available chat models. Check Settings → Bamboo account for the current status.', 'UNKNOWN_MODEL')
    }
    if (!this.models.some(item => item.id === model)) {
      throw new LlmError('The selected Bamboo model is unavailable. Choose another model.', 'UNKNOWN_MODEL')
    }
    return this.adapter
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    await this.load(signal)
    return this.configured(model).resolveModel(provider, model, signal)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.load(signal)
    const adapter = this.configured(model)
    const supportsTools = this.models.some(item => item.id === model && item.tools)
    const call = await adapter.prepareCall(provider, model, signal)
    return supportsTools ? call : { model: call.model, stream: options => chatStream(call, options) }
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) {
    return this.adapter?.imageRequestTarget(provider, model, image) ?? super.imageRequestTarget(provider, model, image)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = await this.prepareCall(options.provider, options.model, options.signal)
    yield* call.stream(options)
  }
}

export function applyBamboo(ctx: Context): boolean {
  const bridge = Reflect.get(globalThis, Symbol.for('bamboo.desktop.bridge')) as Bridge | undefined
  if (!bridge) return false
  const adapter = new BambooAdapter(ctx, bridge)
  ctx.llm.registerAdapter(['bamboo'], adapter)
  return true
}
