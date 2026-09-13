import type { NextConfig } from "next";

const TUNNEL_HOSTS = ["*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io", "*.ngrok-free.dev"];

const nextConfig: NextConfig = {
  allowedDevOrigins: TUNNEL_HOSTS,
  experimental: {
    serverActions: {
      allowedOrigins: TUNNEL_HOSTS,
    },
  },
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/core",
    "@langchain/google-genai",
    "@google/generative-ai",
  ],
};

export default nextConfig;
