import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // transformers.js ships node-only bindings that must never be bundled for the browser.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": false,
      sharp: false,
    };
    return config;
  },
};

export default nextConfig;
