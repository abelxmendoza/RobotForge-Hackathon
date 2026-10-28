import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import RobotDetail from "@/components/robots/RobotDetail";
import { findRobot, robots, robotSlug } from "@/lib/data";

export function generateStaticParams() {
  return robots.map((r) => ({ slug: robotSlug(r) }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const robot = findRobot(slug);
  if (!robot) return {};
  return {
    title: robot.name,
    description: `${robot.name} in the RobotForge Robodex: spec, gate runs and take-apart kit.`,
  };
}

export default async function RobotPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const robot = findRobot(slug);
  if (!robot) notFound();
  return (
    <AppShell
      active="robots"
      crumbs={[
        { label: "App", href: "/forge/" },
        { label: "Robots", href: "/robots/" },
        { label: robot.name },
      ]}
    >
      <RobotDetail robot={robot} />
    </AppShell>
  );
}
