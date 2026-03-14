/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    // Silence MetaMask SDK and WalletConnect warnings
    config.externals.push('pino-pretty', '@react-native-async-storage/async-storage');
    return config;
  },
};

export default nextConfig;
