import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle (.next/standalone) for the Cloud Run
  // Docker image (see Dockerfile). Required for the multi-stage runner stage.
  output: "standalone",
};

export default nextConfig;
