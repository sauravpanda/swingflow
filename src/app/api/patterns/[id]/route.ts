import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const pattern = await db.pattern.findFirst({
    where: {
      OR: [{ id }, { slug: id }],
    },
    include: {
      checklistTemplates: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!pattern) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }

  return NextResponse.json(pattern);
}
