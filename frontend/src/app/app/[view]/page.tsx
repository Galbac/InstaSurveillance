import { notFound } from "next/navigation";
import Dashboard from "@/components/dashboard";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (
    ![
      "people",
      "changes",
      "history",
      "analytics",
      "connect",
      "import",
      "settings",
      "notifications",
      "help",
    ].includes(view)
  )
    notFound();
  return <Dashboard initialView={view} />;
}
