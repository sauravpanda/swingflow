// Canonical WSDC pattern vocabulary for the /label tab dropdowns.
// Sourced from UCWDC Syllabus A–D, Library of Dance catalog, and
// WCS Online Pattern Progress Chart — matches the AI's pattern
// prompt so labels and AI predictions share the same name space.
//
// Keep this in sync with api/src/wcs_api/services/video_analysis/
// prompts.py — if you add a pattern family there, add it here so
// users can label it.

export type PatternCount = 6 | 8;

export type PatternFamily = {
  /** Label family value we store in pattern_labels.name. */
  id: string;
  /** Display label for dropdowns. */
  label: string;
  /** 6-count, 8-count, or either (null). Used to pre-fill the count
      field when the user picks this family. */
  defaultCount: PatternCount | null;
  /** Optional group — we render one OptGroup per group. */
  group: "6-count" | "8-count whip family" | "8-count other" | "position" | "styling";
  /** Aliases the AI might emit — used to normalize AI-predicted names
      onto this family when pre-populating the label editor. */
  aliases?: string[];
};

export type PatternVariant = {
  /** Variant value stored in pattern_labels.variant. */
  id: string;
  /** Display label. */
  label: string;
  /** Family ids this variant applies to. */
  families: string[];
};

export const PATTERN_FAMILIES: PatternFamily[] = [
  // 6-count
  { id: "sugar push", label: "Sugar push", defaultCount: 6, group: "6-count", aliases: ["push break"] },
  { id: "sugar tuck", label: "Sugar tuck", defaultCount: 6, group: "6-count", aliases: ["same side tuck"] },
  { id: "left side pass", label: "Left side pass", defaultCount: 6, group: "6-count" },
  { id: "right side pass", label: "Right side pass", defaultCount: 6, group: "6-count", aliases: ["under arm pass", "underarm turn"] },
  { id: "tuck turn", label: "Tuck turn", defaultCount: 6, group: "6-count", aliases: ["tuck"] },
  { id: "free spin", label: "Free spin", defaultCount: 6, group: "6-count" },
  { id: "starter step", label: "Starter step", defaultCount: 6, group: "6-count" },
  { id: "throwout", label: "Throwout", defaultCount: 6, group: "6-count" },
  { id: "cutoff", label: "Cutoff", defaultCount: 6, group: "6-count" },
  { id: "left spinning side pass", label: "Left spinning side pass", defaultCount: 6, group: "6-count" },
  { id: "inside turn", label: "Inside turn", defaultCount: 6, group: "6-count" },
  { id: "outside roll", label: "Outside roll", defaultCount: 6, group: "6-count" },
  { id: "rock and go", label: "Rock and go", defaultCount: 6, group: "6-count" },
  { id: "6-count elbow catch", label: "6-count elbow catch", defaultCount: 6, group: "6-count" },
  { id: "bowtie", label: "Bowtie", defaultCount: 6, group: "6-count" },
  { id: "fold", label: "Fold", defaultCount: 6, group: "6-count", aliases: ["shootout"] },
  { id: "roll in roll out", label: "Roll in – roll out", defaultCount: 6, group: "6-count" },

  // 8-count whip family
  { id: "whip", label: "Whip", defaultCount: 8, group: "8-count whip family" },
  { id: "basket whip", label: "Basket whip", defaultCount: 8, group: "8-count whip family", aliases: ["cradle whip", "cuddle whip", "locked whip"] },
  { id: "closed whip", label: "Closed whip", defaultCount: 8, group: "8-count whip family" },
  { id: "inside whip", label: "Inside whip", defaultCount: 8, group: "8-count whip family" },
  { id: "reverse whip", label: "Reverse whip (left-side whip)", defaultCount: 8, group: "8-count whip family" },
  { id: "texas tommy", label: "Texas Tommy", defaultCount: 8, group: "8-count whip family", aliases: ["apache whip", "texas tommy whip"] },
  { id: "tandem whip", label: "Tandem whip", defaultCount: 8, group: "8-count whip family" },
  { id: "shadow whip", label: "Shadow whip (Titanic)", defaultCount: 8, group: "8-count whip family" },
  { id: "tunnel whip", label: "Tunnel whip", defaultCount: 8, group: "8-count whip family" },
  { id: "dishrag whip", label: "Dishrag whip", defaultCount: 8, group: "8-count whip family" },
  { id: "windows whip", label: "Windows whip", defaultCount: 8, group: "8-count whip family" },
  { id: "matador whip", label: "Matador whip", defaultCount: 8, group: "8-count whip family" },
  { id: "same side whip", label: "Same side whip", defaultCount: 8, group: "8-count whip family" },
  { id: "hustle whip", label: "Hustle whip", defaultCount: 8, group: "8-count whip family" },
  { id: "carwash whip", label: "Carwash whip", defaultCount: 8, group: "8-count whip family" },
  { id: "pull through whip", label: "Pull-through whip", defaultCount: 8, group: "8-count whip family" },
  { id: "decapitive whip", label: "Decapitive whip (decap)", defaultCount: 8, group: "8-count whip family", aliases: ["decap whip"] },
  { id: "behind the back whip", label: "Behind-the-back whip", defaultCount: 8, group: "8-count whip family" },
  { id: "over the head whip", label: "Over-the-head whip", defaultCount: 8, group: "8-count whip family" },
  { id: "outside walking whip", label: "Outside walking whip", defaultCount: 8, group: "8-count whip family" },
  { id: "underarm whip", label: "Underarm whip", defaultCount: 8, group: "8-count whip family" },
  { id: "half whip & throwout", label: "Half whip & throwout", defaultCount: 8, group: "8-count whip family" },
  { id: "continuous whip", label: "Continuous whip (rolling)", defaultCount: 8, group: "8-count whip family" },
  { id: "extended whip", label: "Extended whip", defaultCount: 8, group: "8-count whip family" },
  { id: "catch and release", label: "Catch and release", defaultCount: 8, group: "8-count whip family" },
  { id: "reverse catch and release", label: "Reverse catch and release", defaultCount: 8, group: "8-count whip family" },
  { id: "around the world", label: "Around the world", defaultCount: 8, group: "8-count whip family" },
  { id: "lead's cradle whip", label: "Lead's cradle whip", defaultCount: 8, group: "8-count whip family" },

  // 8-count other
  { id: "slingshot", label: "Slingshot", defaultCount: 8, group: "8-count other" },
  { id: "hip catch", label: "Hip catch", defaultCount: 8, group: "8-count other" },
  { id: "barrel roll", label: "Barrel roll", defaultCount: 8, group: "8-count other" },
  { id: "changing places", label: "Changing places", defaultCount: 8, group: "8-count other", aliases: ["change of places"] },
  { id: "arm bar", label: "Arm bar", defaultCount: 8, group: "8-count other" },
  { id: "single-double", label: "Single-double", defaultCount: 8, group: "8-count other" },
  { id: "wrap in wrap out", label: "Wrap in – wrap out", defaultCount: 8, group: "8-count other" },
  { id: "wrapping side pass", label: "Wrapping side pass", defaultCount: 8, group: "8-count other" },
  { id: "rolling off the back pass", label: "Rolling off the back pass", defaultCount: 8, group: "8-count other" },
];

// Variants applicable to multiple families. We show these in the
// variant dropdown, filtered to those that apply to the picked family.
export const PATTERN_VARIANTS: PatternVariant[] = [
  { id: "basic", label: "basic", families: ["*"] },
  { id: "with inside turn", label: "with inside turn", families: ["sugar push", "sugar tuck", "left side pass", "right side pass", "whip", "tuck turn"] },
  { id: "with outside turn", label: "with outside turn", families: ["left side pass", "right side pass", "whip"] },
  { id: "with double inside turn", label: "with double inside turn", families: ["whip", "tuck turn"] },
  { id: "with double outside turn", label: "with double outside turn", families: ["whip"] },
  { id: "with free spin", label: "with free spin", families: ["whip"] },
  { id: "with double free spin", label: "with double free spin", families: ["whip"] },
  { id: "with hand change", label: "with hand change", families: ["sugar push", "left side pass", "right side pass", "tuck turn"] },
  { id: "with hand change behind the back", label: "with hand change behind the back", families: ["sugar push", "whip"] },
  { id: "with hand change behind the head", label: "with hand change behind the head", families: ["whip"] },
  { id: "with rock and go", label: "with rock-and-go anchor", families: ["*"] },
  { id: "double tuck", label: "double tuck", families: ["tuck turn"] },
  { id: "single", label: "single (360°)", families: ["free spin"] },
  { id: "double", label: "double (720°)", families: ["free spin"] },
  { id: "triple", label: "triple (1080°)", families: ["free spin"] },
];

/**
 * Normalize an AI-emitted pattern name onto a canonical family id.
 * Returns null when the name doesn't match any known family or alias,
 * so the caller can surface a "non-canonical" indicator in the editor.
 */
export function normalizePatternName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  for (const f of PATTERN_FAMILIES) {
    if (f.id === norm) return f.id;
    if (f.aliases?.some((a) => a === norm)) return f.id;
  }
  return null;
}

export function variantsFor(familyId: string): PatternVariant[] {
  return PATTERN_VARIANTS.filter(
    (v) => v.families.includes("*") || v.families.includes(familyId)
  );
}
