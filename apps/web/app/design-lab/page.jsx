import { notFound } from "next/navigation";
import { DesignLab } from "@/components/design/DesignLab";

export default function DesignLabPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DesignLab />;
}
