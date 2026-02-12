import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const anchors = await db.anchorType.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(anchors);
}
