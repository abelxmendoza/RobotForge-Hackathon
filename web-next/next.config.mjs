/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // Use the installed TypeScript 5 compiler API; CLI subprocess capture is unreliable here.
  experimental: { useTypeScriptCli: false },
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
