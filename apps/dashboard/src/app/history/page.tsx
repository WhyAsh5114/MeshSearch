export default function HistoryPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Search History</h1>
        <p className="text-gray-500">
          Wallet-gated encrypted history viewer. Connect your wallet to decrypt Fileverse entries.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-xl font-bold mb-2">Connect Wallet to View History</h2>
        <p className="text-gray-500 mb-6">
          Your search history is encrypted with your wallet key on Fileverse.
          Only you can decrypt and view your searches.
        </p>
        <button className="bg-mesh-600 text-white px-6 py-3 rounded-lg hover:bg-mesh-700 transition-colors font-medium">
          Connect Wallet
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
        <h3 className="font-bold mb-4">How it works</h3>
        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex gap-3">
            <span className="font-mono text-mesh-600">1.</span>
            Every search creates an encrypted entry on Fileverse/IPFS
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-mesh-600">2.</span>
            Entries are encrypted with your wallet&apos;s key — nobody else can read them
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-mesh-600">3.</span>
            Sign a message with your wallet to derive the decryption key
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-mesh-600">4.</span>
            History is decrypted client-side — the server never sees your searches
          </li>
        </ol>
      </div>
    </div>
  );
}
