import { redirect } from "next/navigation";

export default function AssemblyPage() {
  const base = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:8137";
  redirect(`${base}/?view=assembly`);
}
