// Compatibility seam, not a complete replacement for Claude Agent SDK.
// Registered backend MUST be supplied by a separately audited integration.
let backendFactory;
export function registerBackend(factory) {
  if (typeof factory !== 'function') throw new Error('BACKEND_FACTORY_REQUIRED');
  backendFactory = factory;
}
export function clearBackend() { backendFactory = undefined; }
export function tool(name, description, schema, handler) {
  if (!name || typeof handler !== 'function') throw new Error('INVALID_TOOL');
  return Object.freeze({ name, description, schema, handler });
}
export function createSdkMcpServer({ name, version, tools = [] }) {
  return Object.freeze({ type: 'unported-office-tools', name, version, tools: Object.freeze([...tools]) });
}
const supported = new Set(['model','systemPrompt','cwd','abortController']);
export function query({ prompt, options = {} }) {
  if (typeof prompt !== 'string') throw new Error('STRING_PROMPT_REQUIRED');
  const unsupported = Object.keys(options).filter(k => !supported.has(k));
  if (unsupported.length) throw new Error(`UNPORTED_CLAUDE_OPTIONS:${unsupported.sort().join(',')}`);
  if (!backendFactory) throw new Error('CODEX_BACKEND_NOT_CONNECTED');
  if (/^claude/i.test(options.model || '')) throw new Error('CLAUDE_MODEL_NOT_PORTED');
  let current;
  return {
    async *[Symbol.asyncIterator]() {
      if (options.abortController?.signal.aborted) throw new Error('ABORTED');
      current = await backendFactory(options);
      try {
        yield* current.stream(prompt, { signal: options.abortController?.signal });
      } finally { await current.close?.(); }
    },
    async interrupt() { await current?.interrupt?.(); }
  };
}
