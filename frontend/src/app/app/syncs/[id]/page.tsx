import Dashboard from "@/components/dashboard";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Dashboard initialView="sync" resourceId={id} />;
}
