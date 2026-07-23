import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppNav } from "@/components/nav/AppNav";
import { navItemsForRole } from "@/components/nav/nav-config";
import { getSessionUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "BCC Rentals Admin",
  description: "Administration app for the BCC Rentals catalog and calendar.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getSessionUser();
  // Only signed-in users see the menu bar. The entries are filtered by role for
  // convenience; the server guards remain the real access-control boundary.
  const items = user ? navItemsForRole(user.role) : [];

  return (
    <html lang="en">
      <body>
        {user ? <AppNav items={items} userLabel={user.email} /> : null}
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
