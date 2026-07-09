import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@panelito/types", "@xyflow/react", "@xyflow/system"],
};

export default nextConfig;
