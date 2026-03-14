const BASE = 'http://localhost:3038';

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

async function main() {
  // 1. Initialize
  const initRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-test', version: '0.1.0' } }
    })
  });
  const sid = initRes.headers.get('mcp-session-id');
  console.log('Session:', sid);

  // 2. Initialized notification
  await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  // 3. Call private_search
  console.log('\nCalling private_search({query: "what is ethereum"})...\n');
  const searchRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'private_search', arguments: { query: 'what is ethereum' } }
    })
  });
  const searchText = await searchRes.text();
  const msgs = parseSSE(searchText);
  if (msgs[0]?.result) {
    const content = msgs[0].result.content?.[0]?.text || 'No text';
    console.log('SUCCESS! First 800 chars:\n');
    console.log(content.slice(0, 800));
  } else if (msgs[0]?.error) {
    console.log('ERROR:', JSON.stringify(msgs[0].error));
  } else {
    console.log('RAW:', searchText.slice(0, 500));
  }
}

main().catch(e => console.error('Fatal:', e));
