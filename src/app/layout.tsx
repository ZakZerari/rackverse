import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RackVerse",
  description: "A multi-agent AI server-rack designer, built through Mubit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
