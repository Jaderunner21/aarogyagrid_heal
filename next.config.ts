import path from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // A package-lock.json in the user's home folder would otherwise be picked as the workspace root.
  turbopack: { root: path.resolve(__dirname) },
}

export default nextConfig
