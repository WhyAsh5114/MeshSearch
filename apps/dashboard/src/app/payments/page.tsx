export default function PaymentsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Payment Flows</h1>
        <p className="text-gray-500">
          x402 micropayment visualization — anonymous payments split between relay operators.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-bold mb-4">Payment Flow</h3>
          <div className="space-y-4 text-sm">
            <FlowStep
              step={1}
              title="Search Request"
              description="User or agent initiates a private search"
            />
            <FlowArrow />
            <FlowStep
              step={2}
              title="402 Payment Required"
              description="Server returns payment address and amount (USDC on Base)"
            />
            <FlowArrow />
            <FlowStep
              step={3}
              title="Micropayment"
              description="Client pays automatically — no account, no identity"
            />
            <FlowArrow />
            <FlowStep
              step={4}
              title="Payment Split"
              description="Smart contract splits payment between 3 relay nodes + protocol"
            />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-bold mb-4">Split Distribution</h3>
          <div className="space-y-4">
            <SplitBar label="relay1.meshsearch.eth" share={25} color="bg-blue-500" />
            <SplitBar label="relay2.meshsearch.eth" share={25} color="bg-green-500" />
            <SplitBar label="relay3.meshsearch.eth" share={25} color="bg-purple-500" />
            <SplitBar label="Protocol Fee" share={25} color="bg-gray-500" />
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Shares configurable by contract owner. Default: 25% per relay + 25% protocol.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
        <h3 className="font-bold mb-4">Key Properties</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="font-medium">No Account Required</p>
            <p className="text-gray-500">Pay directly from any wallet</p>
          </div>
          <div>
            <p className="font-medium">Payment Unlinking</p>
            <p className="text-gray-500">Nullifiers prevent linking payments to queries</p>
          </div>
          <div>
            <p className="font-medium">Relay Incentives</p>
            <p className="text-gray-500">Operators earn passively for routing infrastructure</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowStep({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-mesh-600 text-white flex items-center justify-center text-xs font-bold">
        {step}
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-gray-500">{description}</p>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center">
      <span className="text-gray-400">↓</span>
    </div>
  );
}

function SplitBar({ label, share, color }: { label: string; share: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-mono text-xs">{label}</span>
        <span>{share}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
        <div className={`${color} h-3 rounded-full`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
