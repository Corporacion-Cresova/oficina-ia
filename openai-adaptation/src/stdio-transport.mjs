import { AppServerClient } from './adapter.mjs';
// NDJSON transport over an explicitly supplied child process. No credentials logged.
export function attachStdio(child, { timeoutMs = 10000, maxFrameBytes = 1048576 } = {}) {
  let buffer = ''; let ended = false;
  const rpc = new AppServerClient(message => {
    if (ended || !child.stdin?.writable) throw new Error('TRANSPORT_CLOSED');
    child.stdin.write(JSON.stringify(message)+'\n');
  }, { timeoutMs });
  const stop = () => { if (ended) return; ended = true; rpc.close(); child.kill?.(); };
  const onData = chunk => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
      if (Buffer.byteLength(line) > maxFrameBytes) return stop();
      if (!line.trim()) continue;
      try { rpc.receive(JSON.parse(line)); } catch { stop(); return; }
    }
    if (Buffer.byteLength(buffer) > maxFrameBytes) stop();
  };
  child.stdout.setEncoding('utf8'); child.stdout.on('data',onData); child.stdout.once('end',stop);
  child.stderr?.resume(); // drain, never expose auth URLs/tokens/raw stderr
  child.once('error',stop);child.once('exit',stop);child.stdin.on('error',stop);
  return { rpc, close:stop };
}
