const BASE = process.env.MCP_URL || 'http://localhost:3038';

function parseSSE(text) {
  const messages = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        try { messages.push(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
  return messages;
}

/** Parse response: handles both plain JSON and SSE formats */
async function parseResponse(res) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (ct.includes('text/event-stream')) {
    return parseSSE(text);
  }
  try { return [JSON.parse(text)]; } catch { return [{ _raw: text }]; }
}

async function main() {
  console.log(`Testing MCP server at ${BASE}\n`);

  // 0. Health check
  try {
    const h = await fetch(`${BASE.replace('/mcp', '')}/health`);
    console.log('Health:', await h.json());
  } catch (e) {
    console.error('Health check failed — is the server running?', e.message);
    process.exit(1);
  }

  // 1. Initialize
  console.log('\n--- Step 1: Initialize ---');
  const initRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-test', version: '0.1.0' } }
    })
  });
  const sid = initRes.headers.get('mcp-session-id');
  console.log('Status:', initRes.status);
  console.log('Session ID:', sid);
  const initMsgs = await parseResponse(initRes);
  console.log('Response:', JSON.stringify(initMsgs[0], null, 2));

  if (!sid) {
    console.error('\nFATAL: No session ID returned. Cannot continue.');
    process.exit(1);
  }

  const sessionHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-session-id': sid,
  };

  // 2. Initialized notification
  console.log('\n--- Step 2: notifications/initialized ---');
  const notifRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });
  console.log('Status:', notifRes.status);

  // 3. List tools
  console.log('\n--- Step 3: tools/list ---');
  const listRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  });
  console.log('Status:', listRes.status);
  const listMsgs = await parseResponse(listRes);
  const tools = listMsgs[0]?.result?.tools || [];
  console.log(`Tools found: ${tools.length}`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description?.slice(0, 60)}`);
  }

  if (tools.length === 0) {
    console.error('\nWARNING: No tools listed! Something is wrong with tool registration.');
  }

  // 4. Call private_search
  console.log('\n--- Step 4: tools/call private_search ---');
  const searchRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'private_search', arguments: { query: 'what is ethereum' } }
    })
  });
  console.log('Status:', searchRes.status);
  console.log('Content-Type:', searchRes.headers.get('content-type'));
  const searchMsgs = await parseResponse(searchRes);
  console.log('Parsed messages:', searchMsgs.length);
  if (searchMsgs.length > 0) {
    console.log('Message keys:', Object.keys(searchMsgs[0]));
  }
  if (searchMsgs[0]?.result) {
    console.log('Result structure:', JSON.stringify(searchMsgs[0].result, null, 2).slice(0, 1500));
    const content = searchMsgs[0].result.content?.[0]?.text || 'No text content';
    console.log('\nFirst 500 chars of text:\n');
    console.log(content.slice(0, 500));
  } else if (searchMsgs[0]?.error) {
    console.log('ERROR:', JSON.stringify(searchMsgs[0].error, null, 2));
  } else {
    console.log('RAW response:', JSON.stringify(searchMsgs, null, 2).slice(0, 1000));
  }

  console.log('\n✅ E2E test complete');
}

main().catch(e => console.error('Fatal:', e));
