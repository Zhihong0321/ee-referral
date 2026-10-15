import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/guide", destination: "/referral-assistant-guide.html" }];
  },
};

export default nextConfig;
