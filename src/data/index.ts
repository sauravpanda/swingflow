import patternsJson from "./patterns.json";
import anchorsJson from "./anchors.json";

export type Pattern = {
  id: string;
  name: string;
  slug: string;
  beats: number;
  difficulty: string;
  category: string;
  description: string;
  mechanics: string;
  commonMistakes: string;
  videoUrl: string | null;
  imageUrl: string | null;
  checklistTemplates: {
    id: string;
    patternId: string;
    category: string;
    item: string;
    sortOrder: number;
  }[];
};

export type AnchorType = {
  id: string;
  name: string;
  slug: string;
  description: string;
  execution: string;
  musicality: string;
  difficulty: string;
  imageUrl: string | null;
};

export const patterns: Pattern[] = patternsJson as Pattern[];
export const anchors: AnchorType[] = anchorsJson as AnchorType[];

export function getPatternBySlugOrId(idOrSlug: string): Pattern | undefined {
  return patterns.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
}

export function filterPatterns(opts: {
  difficulty?: string;
  category?: string;
  search?: string;
}): Pattern[] {
  return patterns.filter((p) => {
    if (opts.difficulty && p.difficulty !== opts.difficulty) return false;
    if (opts.category && p.category !== opts.category) return false;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
        return false;
    }
    return true;
  });
}
