import Dashboard from "@/components/dashboard";

export default async function Demo({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; category?: string }>;
}) {
  const params = await searchParams;
  const initialView =
    params?.category || params?.view === "people"
      ? "people"
      : params?.view || "people";
  return <Dashboard demo initialView={initialView} />;
}
