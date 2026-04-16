import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Music,
  Video,
  Sparkles,
  Check,
  ArrowRight,
  Timer,
  Zap,
  UserPlus,
  History,
  ShieldCheck,
  Share2,
  HelpCircle,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ─── Nav ─── */}
      <header className="border-b border-border/60 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                SF
              </span>
            </div>
            <span className="text-lg font-semibold">SwingFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ─── Hero ─── */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--primary)/10,_transparent_60%)] pointer-events-none" />
          <div className="container mx-auto px-4 pt-12 pb-12 sm:pt-28 sm:pb-20 relative">
            <div className="max-w-3xl mx-auto text-center space-y-5 sm:space-y-6">
              <Badge variant="secondary" className="px-3 py-1 text-xs">
                <Sparkles className="h-3 w-3 mr-1.5" />
                Built for West Coast Swing dancers
              </Badge>
              <h1 className="text-3xl sm:text-6xl font-bold tracking-tight leading-tight">
                See exactly where you&rsquo;re{" "}
                <span className="text-primary">dancing off-beat</span>
              </h1>
              <p className="text-base sm:text-xl text-muted-foreground max-w-2xl mx-auto">
                Upload a song and SwingFlow finds every anchor. Upload a dance
                clip and you get WSDC-style scoring on timing, technique,
                teamwork, and presentation — with the exact moments that need
                work.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <Button size="lg" asChild>
                  <Link href="/login">
                    Start free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="#how-it-works">How it works</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                No credit card required · 1 video analysis / month free ·
                Unlimited music analysis
              </p>
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section
          id="how-it-works"
          className="border-t border-border/60 bg-card/20"
        >
          <div className="container mx-auto px-4 py-12 sm:py-24">
            <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-4 w-4" />
                How it works
              </div>
              <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
                From song to feedback in four steps
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
              <ProcessStep
                step={1}
                icon={<UserPlus className="h-5 w-5" />}
                title="Create your account"
                description="Free, no credit card. Email and password, that's it."
              />
              <ProcessStep
                step={2}
                icon={<Music className="h-5 w-5" />}
                title="Upload a song"
                description="Get precise BPM, downbeats, 8-count phrases, and every anchor position marked — instantly."
              />
              <ProcessStep
                step={3}
                icon={<Video className="h-5 w-5" />}
                title="Record your dance"
                description="Upload a clip. Get WSDC-style scoring on timing, technique, teamwork, and presentation in about 60 seconds."
              />
              <ProcessStep
                step={4}
                icon={<History className="h-5 w-5" />}
                title="Review and iterate"
                description="Past analyses stay in your history. Compare, track progress, drill the weak spots."
              />
            </div>
          </div>
        </section>

        {/* ─── Feature 1: Music analysis with the phrase-beat-grid mockup ─── */}
        <section className="container mx-auto px-4 py-12 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-5 order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <Music className="h-4 w-4" />
                Precise music analysis
              </div>
              <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
                Every anchor, marked precisely
              </h2>
              <p className="text-muted-foreground text-lg">
                Drop in any MP3. SwingFlow runs the song through librosa and
                returns the exact timestamp of every beat, every downbeat, and
                every 8-count phrase boundary — so you can see where the
                anchor steps fall before you ever hit play.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>Accurate BPM detection (no guessing)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>8-count phrase grouping — see where you are in the song</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>
                    Anchor positions highlighted on beats 5 and 6 of every phrase
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>Unlimited for everyone — free and Basic</span>
                </li>
              </ul>
            </div>

            {/* Visual mockup of the phrase-beat-grid */}
            <div className="order-1 lg:order-2">
              <Card className="border-border/60 bg-card/40 backdrop-blur">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">
                      Song phrase
                    </span>
                    <span className="font-mono tabular-nums">3 / 9</span>
                  </div>
                  <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                    {["1", "2", "3", "4", "5", "6", "7", "8"].map((label, i) => {
                      const isDownbeat = i === 0;
                      const isAnchor = i === 4 || i === 5;
                      const isActive = i === 4; // highlight anchor beat 5
                      return (
                        <div
                          key={i}
                          className={[
                            "relative flex h-12 sm:h-14 flex-col items-center justify-center rounded-md border font-semibold",
                            isAnchor
                              ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                              : isDownbeat
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border bg-muted/20 text-muted-foreground",
                            isActive
                              ? "ring-2 ring-offset-2 ring-offset-background ring-primary scale-[1.08]"
                              : "",
                          ].join(" ")}
                        >
                          <span className="text-sm sm:text-base">{label}</span>
                          {isAnchor && (
                            <span className="absolute bottom-0.5 sm:bottom-1 text-[7px] sm:text-[8px] font-normal uppercase tracking-wider opacity-70">
                              anchor
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm bg-primary/60" />
                      downbeat
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm bg-amber-400/60" />
                      anchor (5–6)
                    </span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-center text-muted-foreground mt-3">
                The Rhythm page, live-synced to your song
              </p>
            </div>
          </div>
        </section>

        {/* ─── Feature 2: Video scoring ─── */}
        <section className="border-y border-border/60 bg-card/20">
          <div className="container mx-auto px-4 py-12 sm:py-24">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <Card className="border-border/60 bg-card/60 backdrop-blur">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-bold tabular-nums">
                          7.8
                        </span>
                        <span className="text-lg text-muted-foreground">
                          / 10
                        </span>
                      </div>
                      <Badge>B+</Badge>
                    </div>
                    <div className="space-y-2.5 pt-2">
                      {[
                        { name: "Timing & Rhythm", score: 8.0 },
                        { name: "Technique", score: 7.5 },
                        { name: "Teamwork", score: 8.2 },
                        { name: "Presentation", score: 7.3 },
                      ].map((cat) => (
                        <div key={cat.name} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{cat.name}</span>
                            <span className="font-mono tabular-nums">
                              {cat.score.toFixed(1)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${cat.score * 10}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-3 text-xs text-muted-foreground border-t border-border/60">
                      <span className="font-medium text-foreground">
                        Timing notes:
                      </span>{" "}
                      Anchor steps occasionally rush into the next pattern on
                      sugar pushes at 0:12 and 0:34. Walks land on beat.
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Video className="h-4 w-4" />
                  Dance video analysis
                </div>
                <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
                  Honest feedback, in 60 seconds
                </h2>
                <p className="text-muted-foreground text-lg">
                  Upload a clip of yourself dancing. You get a WSDC-style
                  rubric breakdown — scored on timing, technique, teamwork,
                  and presentation — with specific moments referenced by
                  timestamp. No more &ldquo;you&rsquo;re doing great&rdquo;
                  from a friend who doesn&rsquo;t know what to look for.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      Four-category WSDC rubric with calibrated 1&ndash;10 scores
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Pattern timeline — what you danced and when</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      Off-beat moments flagged with timestamps and beat counts
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      Strengths and specific, actionable improvements
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Feature 3 row: Rhythm trainer + Pattern library ─── */}
        <section className="container mx-auto px-4 py-12 sm:py-24">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
              Everything you need to practice with intention
            </h2>
            <p className="text-muted-foreground text-lg">
              The rhythm mechanics that separate novice from all-star, built
              into one app.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Rhythm trainer"
              description="Beat grid with 16th-note subdivisions, tap-along challenges, tempo ramps, and accent-pattern drills."
            />
            <FeatureCard
              icon={<Timer className="h-5 w-5" />}
              title="Practice timer"
              description="Structured 5, 15, and 30-minute routines. Track your streak and total practice time."
            />
            <FeatureCard
              icon={<Music className="h-5 w-5" />}
              title="Precise song analysis"
              description="librosa-powered BPM, downbeat, and 8-count phrase detection. Your song becomes a practice timeline."
            />
          </div>
        </section>

        {/* ─── Pricing ─── */}
        <section className="border-t border-border/60 bg-card/20">
          <div className="container mx-auto px-4 py-12 sm:py-24">
            <div className="text-center max-w-2xl mx-auto mb-10 space-y-3">
              <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
                Simple pricing
              </h2>
              <p className="text-muted-foreground text-lg">
                Music analysis is unlimited for everyone. Upgrade for more
                video scoring.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {/* Free */}
              <Card className="border-border/60 bg-card/40 backdrop-blur">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-xl font-bold">Free</h3>
                    <Badge variant="secondary">$0</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Everything you need to start practicing smarter.
                  </p>
                  <ul className="space-y-2 text-sm pt-2">
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Unlimited precise music analysis</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Rhythm trainer, beat grid, tap challenges</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>1 dance video analysis / month (up to 2 min)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Practice timer + streak tracking</span>
                    </li>
                  </ul>
                  <Button variant="outline" className="w-full mt-4" asChild>
                    <Link href="/login">Start free</Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Basic */}
              <Card className="border-primary/50 bg-card/40 backdrop-blur ring-1 ring-primary/30 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-2">
                  <Badge className="px-3">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Most popular
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="px-2 bg-amber-500/20 text-amber-200 border-amber-500/40"
                  >
                    Save 50%
                  </Badge>
                </div>
                <CardContent className="p-6 space-y-4 pt-8">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-xl font-bold">Basic</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-base text-muted-foreground line-through">
                        $20
                      </span>
                      <span className="text-2xl font-bold">$10</span>
                      <span className="text-sm text-muted-foreground">
                        /mo
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Serious practice. More videos, longer clips.{" "}
                    <span className="text-amber-200">
                      Launch pricing — $10/mo while it lasts.
                    </span>
                  </p>
                  <ul className="space-y-2 text-sm pt-2">
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Everything in Free</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span className="font-medium">
                        10 dance video analyses / month
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Up to 5-minute clips</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>Cancel anytime, access until period end</span>
                    </li>
                  </ul>
                  <Button className="w-full mt-4" asChild>
                    <Link href="/login">Upgrade to Basic — $10/mo</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ─── Privacy callout ─── */}
        <section className="container mx-auto px-4 py-12">
          <Card className="border-border/60 bg-card/40 backdrop-blur">
            <CardContent className="p-6 sm:p-8 grid gap-6 sm:grid-cols-3 items-start">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-sm">
                    Videos deleted after scoring
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    We only keep the structured result — not your raw clip.
                    Uploads auto-delete from storage the moment the scoring
                    run finishes.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Share2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-sm">
                    Share privately with a link
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Send a coach or partner a private share link to your
                    score. Revoke whenever — old links stop working
                    immediately.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Zap className="h-6 w-6 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-sm">
                    Your data, your call
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Delete any analysis from history in one click. Cancel
                    anytime. No data held hostage.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ─── FAQ ─── */}
        <section className="container mx-auto px-4 py-16 sm:py-20">
          <div className="text-center max-w-2xl mx-auto mb-10 space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <HelpCircle className="h-4 w-4" />
              FAQ
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
              Common questions
            </h2>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            <FaqItem
              q="What dance style is this scored against?"
              a="West Coast Swing using the WSDC rubric — timing, technique, teamwork, presentation. We're WCS-first today. Support for Lindy Hop, Salsa, Bachata, and others is planned."
            />
            <FaqItem
              q="Is my video stored anywhere?"
              a="No. Your video uploads directly to private storage, we download it once to score, then delete it immediately. Only the structured result (scores, notes, timestamps) is kept in your history."
            />
            <FaqItem
              q="How accurate is the scoring?"
              a="The model is calibrated against novice, intermediate, and champion-level reference examples, and we ground timing judgments in actual detected beats from the music. Think of it as 'a well-read judge' — consistent and specific, not a replacement for a human coach for advanced nuance."
            />
            <FaqItem
              q="How long does an analysis take?"
              a="Typically 30–90 seconds per clip, depending on video length and current load. The upload phase depends on your connection."
            />
            <FaqItem
              q="Can I share my score with a coach?"
              a="Yes. Each analysis has a Share button that generates a private link. Send it to anyone — no account required on their side. You can revoke the link any time."
            />
            <FaqItem
              q="What if I run out of free videos?"
              a="Basic is $10/month with 10 analyses and 5-minute clips. Your free tier resets monthly. Cancel anytime, access stays until the end of the period."
            />
            <FaqItem
              q="Do you support video longer than 5 minutes?"
              a="Not on Basic. Much longer clips dilute the rubric feedback anyway — the sweet spot for useful judging is a 1–3 minute routine or an entire J&J heat."
            />
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="container mx-auto px-4 py-20 text-center">
          <div className="max-w-2xl mx-auto space-y-5">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
              Ready to practice smarter?
            </h2>
            <p className="text-muted-foreground text-lg">
              Free to start. No credit card required.
            </p>
            <Button size="lg" asChild>
              <Link href="/login">
                Create your account
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Created by{" "}
          <a
            href="https://github.com/sauravpanda"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            Saurav Panda
          </a>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur">
      <CardContent className="p-6 space-y-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-lg border border-border/60 bg-card/40 backdrop-blur">
      <summary className="cursor-pointer list-none p-4 flex items-center justify-between font-medium text-sm hover:bg-muted/30 rounded-lg transition-colors">
        <span>{q}</span>
        <span className="text-muted-foreground text-lg leading-none group-open:rotate-45 transition-transform">
          +
        </span>
      </summary>
      <div className="px-4 pb-4 text-sm text-muted-foreground">{a}</div>
    </details>
  );
}

function ProcessStep({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="relative text-center space-y-3">
      <div className="relative mx-auto">
        <div className="h-14 w-14 mx-auto rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/30">
          {icon}
        </div>
        <div className="absolute -top-2 -right-2 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:top-auto sm:-bottom-2 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
          {step}
        </div>
      </div>
      <h3 className="font-semibold pt-3">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
