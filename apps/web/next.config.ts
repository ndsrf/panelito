import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@panelito/types", "@xyflow/react", "@xyflow/system"],
  // apps/web/app/api/[[...route]]/route.ts source-imports the entire @panelito/api
  // Hono app (unified Vercel hosting), whose dependency graph includes
  // @huggingface/transformers -> onnxruntime-node. onnxruntime-node ships prebuilt
  // native .node binaries; these must never be parsed by webpack — they're loaded
  // by Node's require() at runtime instead. Without this, webpack throws
  // "Module parse failed: Unexpected character" on the .node binary.
  serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers"],
};

export default nextConfig;
