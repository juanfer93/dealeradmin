/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return process.env.API_URL
      ? [{ source: '/api/:path*', destination: `${process.env.API_URL}/api/:path*` }]
      : [];
  },
};

export default nextConfig;
