import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle (.next/standalone) for the Cloud Run
  // Docker image (see Dockerfile). Required for the multi-stage runner stage.
  output: "standalone",
  // P9.2: @bcc/scheduler ships TypeScript sources (no build step). App imports
  // resolve to the in-tree sources via tsconfig `paths`; transpilePackages keeps
  // the package compilable should it ever be resolved from node_modules.
  transpilePackages: ["@bcc/scheduler"],
};

export default nextConfig;
