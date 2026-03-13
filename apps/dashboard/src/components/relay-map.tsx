'use client';

import type { RelayNode } from '@meshsearch/types';

interface RelayMapProps {
  nodes: RelayNode[];
}

export function RelayMap({ nodes }: RelayMapProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {nodes.map((node) => (
        <div
          key={node.ensName}
          className={`rounded-lg border p-6 ${
            node.status === 'active'
              ? 'border-green-500/30 bg-green-50 dark:bg-green-950/20'
              : node.status === 'degraded'
              ? 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20'
              : 'border-red-500/30 bg-red-50 dark:bg-red-950/20'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-sm font-bold">{node.ensName}</h3>
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                node.status === 'active'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              {node.status}
            </span>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Reputation</span>
              <span className="font-mono">{node.reputationScore}/100</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-mesh-500 h-2 rounded-full transition-all"
                style={{ width: `${node.reputationScore}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Operator</span>
              <span className="font-mono text-xs">
                {node.operator.slice(0, 6)}...{node.operator.slice(-4)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Endpoint</span>
              <span className="font-mono text-xs truncate max-w-[150px]">{node.endpoint}</span>
            </div>
            {node.lastActiveAt > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Last Active</span>
                <span className="text-xs">{new Date(node.lastActiveAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
