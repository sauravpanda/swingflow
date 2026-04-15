"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Sparkles,
  CreditCard,
  ArrowUpRight,
} from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { createCheckoutSession, createPortalSession } from "@/lib/wcs-api";

export default function BillingPage() {
  const { profile, loading, error } = useProfile();
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    setActing(true);
    setActError(null);
    try {
      const url = await createCheckoutSession(
        `${window.location.origin}/billing?upgraded=1`,
        `${window.location.origin}/billing?canceled=1`
      );
      window.location.href = url;
    } catch (e) {
      setActError(e instanceof Error ? e.message : "Failed to start checkout");
      setActing(false);
    }
  };

  const handleManage = async () => {
    setActing(true);
    setActError(null);
    try {
      const url = await createPortalSession(
        `${window.location.origin}/billing`
      );
      window.location.href = url;
    } catch (e) {
      setActError(
        e instanceof Error ? e.message : "Failed to open billing portal"
      );
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPro = profile?.plan === "pro";

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Billing</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Manage your SwingFlow subscription
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            Could not load profile: {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Current plan</span>
            <Badge variant={isPro ? "default" : "secondary"}>
              {isPro ? "Pro" : "Free"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>
              • Music analysis —{" "}
              <span className="text-foreground">unlimited</span>
            </li>
            <li>
              • Video analysis —{" "}
              <span className="text-foreground">
                {isPro
                  ? "10 per month, up to 5 minutes each"
                  : "1 per month, up to 2 minutes"}
              </span>
            </li>
          </ul>

          {actError && (
            <p className="text-sm text-destructive">{actError}</p>
          )}

          {isPro ? (
            <Button
              onClick={handleManage}
              disabled={acting}
              className="w-full"
              variant="outline"
            >
              {acting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpRight className="mr-2 h-4 w-4" />
              )}
              Manage subscription
            </Button>
          ) : (
            <Button
              onClick={handleUpgrade}
              disabled={acting}
              className="w-full"
            >
              {acting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Upgrade to Pro — $10/mo
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Subscriptions managed by Stripe. Cancel anytime — access continues
        until the end of the period.
      </p>
    </div>
  );
}
