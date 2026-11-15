// Manual-only container entrypoint. Never loads upstream or any model runtime.
import { createOffice } from './src/safe-office.mjs';
let server;
try {
  const origin = new URL(process.env.OFFICE_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('INVALID_ORIGIN');
  if (process.env.OFFICE_ENABLE_CHATGPT_DRAFTS === '1' || ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY'].some(k=>process.env[k])) throw new Error('MANUAL_ONLY');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  server = createOffice({password:process.env.OFFICE_PASSWORD,dataDir:process.env.OFFICE_DATA_DIR,publicOrigin:origin.origin});
  server.on('error',()=>{console.error('Manual service startup failed; inspect private deployment configuration.');process.exit(1);});
  server.listen(port,process.env.HOST || '0.0.0.0',()=>console.log('Manual-only office ready. AI and external actions disabled.'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
    const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
    server.close(()=>process.exit(0));server.closeIdleConnections();
  });
} catch {
  console.error('Manual service refused configuration; HTTPS origin, isolated writable data and password are required.');
  process.exit(1);
}
