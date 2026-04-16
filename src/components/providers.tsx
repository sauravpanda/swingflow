"use client";

import { ThemeProvider } from "next-themes";
import { StoreProvider } from "@/components/store-provider";
import { PostHogProvider } from "@/components/analytics/posthog-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <PostHogProvider>
        <StoreProvider>{children}</StoreProvider>
      </PostHogProvider>
    </ThemeProvider>
  );
}
