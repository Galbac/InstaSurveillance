import React from "react";
import { AdminAuthProvider } from "@/features/admin/auth-context";
import { AdminShell } from "@/features/admin/shell";

export const metadata = {
  title: "Панель управления — InstaSurveillance",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}
