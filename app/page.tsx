import { redirect } from "next/navigation";

export default function Home() {
  // The weekly calendar is the app's landing view (spec §7).
  redirect("/calendar");
}
