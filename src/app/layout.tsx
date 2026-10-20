import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FW Migrate — AI-assisted firewall rule migration",
  description:
    "Parse, analyse, translate, review and export firewall rule bases between Palo Alto, Cisco ASA, Check Point, Fortinet and Juniper SRX.",
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
