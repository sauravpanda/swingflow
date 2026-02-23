"use client";

export function Header() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-full items-center px-4 md:px-6">
        <div className="md:hidden flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">
              SF
            </span>
          </div>
          <span className="text-lg font-semibold">SwingFlow</span>
        </div>
      </div>
    </header>
  );
}
