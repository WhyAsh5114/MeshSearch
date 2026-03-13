/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@meshsearch/types'],
};

export default nextConfig;
