import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "RackOS — Build racks that hold up.",
  description: "An intelligent rack design studio where specialist agents propose layouts and deterministic engineering checks decide what works.",
};

export default function HomePage() {
  return <LandingPage />;
}
