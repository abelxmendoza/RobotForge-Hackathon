/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/RobotForge-Hackathon",
  assetPrefix: "/RobotForge-Hackathon",
  images: { unoptimized: true },
};
export default nextConfig;
