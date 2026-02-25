import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brain, Library, Timer, CheckCircle2, Github } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
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
            <a
              href="https://github.com/sauravpanda/swingflow"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border hover:bg-accent transition-colors"
            >
              <Github className="h-4 w-4" />
            </a>
            <Button asChild>
              <Link href="/dashboard">Open App</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Master West Coast Swing
            <br />
            <span className="text-primary">one pattern at a time</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            SwingFlow is your personal dance companion. Browse 60+ patterns,
            track technique with checklists, and retain everything with
            spaced repetition — built for dancers who practice.
          </p>
          <Button size="lg" asChild>
            <Link href="/dashboard">Get Started</Link>
          </Button>
        </section>

        {/* Features */}
        <section className="container mx-auto px-4 py-16">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center">
                <Library className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">60+ Patterns</h3>
              <p className="text-sm text-muted-foreground">
                Comprehensive library from basics to advanced, with step-by-step
                mechanics and common mistakes.
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <Brain className="h-6 w-6 text-violet-400" />
              </div>
              <h3 className="font-semibold">Spaced Repetition</h3>
              <p className="text-sm text-muted-foreground">
                SM-2 algorithm ensures you review patterns right before you
                forget them. Scientifically proven method.
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <Timer className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="font-semibold">Practice Timer</h3>
              <p className="text-sm text-muted-foreground">
                Structured warm-up routines for 5, 15, or 30 minutes. Built-in
                step-by-step guidance.
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-xl bg-rose-500/15 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-rose-400" />
              </div>
              <h3 className="font-semibold">Technique Checklists</h3>
              <p className="text-sm text-muted-foreground">
                16 technique checkpoints per pattern covering connection, frame,
                posture, timing, and styling.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container mx-auto px-4 py-16 text-center">
          <div className="rounded-2xl border border-border bg-card p-8 sm:p-12 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold mb-2">Ready to level up?</h2>
            <p className="text-muted-foreground mb-6">
              No account needed. Your progress is saved locally on your device.
            </p>
            <Button size="lg" asChild>
              <Link href="/dashboard">Start Practicing</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
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
