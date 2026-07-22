import { redirect } from "next/navigation";

export default function BlueHousePage() {
  const base = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:8137";
  redirect(`${base}/?view=cabinet`);
}
