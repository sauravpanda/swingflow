import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const difficulty = searchParams.get("difficulty");
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = {};

  if (difficulty) where.difficulty = difficulty;
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
    ];
  }

  const patterns = await db.pattern.findMany({
    where,
    orderBy: [{ category: "asc" }, { difficulty: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(patterns);
}
