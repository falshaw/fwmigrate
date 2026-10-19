import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FW Migrate — AI-Powered Firewall Migration",
  description:
    "Universal firewall migration platform for security consultants. Parse, analyze, translate, and export firewall configs across vendors.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-navy-dark text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
