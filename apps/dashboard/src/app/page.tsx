import { RelayMap } from '@/components/relay-map';
import { NetworkStats } from '@/components/network-stats';
import type { RelayNode, RelayStatus } from '@meshsearch/types';

async function getRelayNodes(): Promise<RelayNode[]> {
  const endpoints = (process.env.RELAY_ENDPOINTS || 'http://localhost:4002,http://localhost:4003,http://localhost:4004').split(',');

  const nodes: RelayNode[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const res = await fetch(`${endpoints[i]}/health`, { next: { revalidate: 10 } });
      if (res.ok) {
        const data = (await res.json()) as { ensName?: string; timestamp?: number };
        nodes.push({
          ensName: data.ensName || `relay${i + 1}.meshsearch.eth`,
          operator: `0x${'0'.repeat(38)}${(i + 1).toString().padStart(2, '0')}` as `0x${string}`,
          endpoint: endpoints[i],
          reputationScore: 50,
          status: 'active' as RelayStatus,
          lastActiveAt: data.timestamp || Date.now(),
        });
      }
    } catch {
      nodes.push({
        ensName: `relay${i + 1}.meshsearch.eth`,
        operator: `0x${'0'.repeat(38)}${(i + 1).toString().padStart(2, '0')}` as `0x${string}`,
        endpoint: endpoints[i],
        reputationScore: 0,
        status: 'inactive' as RelayStatus,
        lastActiveAt: 0,
      });
    }
  }
  return nodes;
}

export default async function HomePage() {
  const nodes = await getRelayNodes();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Relay Network</h1>
        <p className="text-gray-500">ENS-named relay nodes with onchain reputation scores</p>
      </div>

      <NetworkStats nodes={nodes} />
      <RelayMap nodes={nodes} />
    </div>
  );
}
