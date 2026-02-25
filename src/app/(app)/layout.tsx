import { SidebarNav } from "@/components/sidebar-nav";
import { MobileNav } from "@/components/mobile-nav";
import { Header } from "@/components/header";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SidebarNav />
      <div className="md:pl-64 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</main>
        <footer className="py-4 pb-20 md:pb-4 text-center text-xs text-muted-foreground">
          Created by{" "}
          <a
            href="https://github.com/sauravpanda"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            Saurav Panda
          </a>
        </footer>
      </div>
      <MobileNav />
    </div>
  );
}
