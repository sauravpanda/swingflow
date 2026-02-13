import Link from "next/link";
import { Button } from "@/components/ui/button";
import { patterns, getPatternBySlugOrId } from "@/data";
import { PatternDetail } from "./pattern-detail";

export function generateStaticParams() {
  return patterns.map((p) => ({ id: p.slug }));
}

export default async function PatternDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pattern = getPatternBySlugOrId(id);

  if (!pattern) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pattern not found</p>
        <Link href="/patterns">
          <Button variant="link" className="mt-2">
            Back to patterns
          </Button>
        </Link>
      </div>
    );
  }

  return <PatternDetail pattern={pattern} />;
}
