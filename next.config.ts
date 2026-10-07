import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // الملفات والصور base64 بتكبّر حجم الطلب
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
};

export default nextConfig;
