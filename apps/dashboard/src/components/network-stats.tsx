import type { RelayNode } from '@meshsearch/types';

interface NetworkStatsProps {
  nodes: RelayNode[];
}

export function NetworkStats({ nodes }: NetworkStatsProps) {
  const activeCount = nodes.filter(n => n.status === 'active').length;
  const avgReputation = nodes.length > 0
    ? Math.round(nodes.reduce((sum, n) => sum + n.reputationScore, 0) / nodes.length)
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard label="Total Nodes" value={nodes.length.toString()} />
      <StatCard label="Active Nodes" value={activeCount.toString()} />
      <StatCard label="Avg Reputation" value={`${avgReputation}/100`} />
      <StatCard label="Network" value="Base Sepolia" />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
