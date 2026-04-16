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
  Check,
} from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { createCheckoutSession, createPortalSession } from "@/lib/wcs-api";
import { Analytics } from "@/lib/analytics";

const BASIC_BENEFITS = [
  "10 dance video analyses per month",
  "Clips up to 5 minutes each",
  "Precise cloud music analysis — unlimited songs",
  "WSDC-style scoring across timing, technique, teamwork, and presentation",
  "Cancel anytime — access continues until the end of your period",
];

const FREE_FEATURES = [
  "1 dance video analysis per month, up to 2 minutes",
  "Precise cloud music analysis — unlimited songs",
];

export default function BillingPage() {
  const { profile, loading, error } = useProfile();
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    Analytics.upgradeClicked({ source: "/billing" });
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
    Analytics.manageSubscriptionClicked();
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

  const isBasic = profile?.plan === "basic";

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

      {/* Current plan card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Current plan</span>
            <Badge variant={isBasic ? "default" : "secondary"}>
              {isBasic ? "Basic" : "Free"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {(isBasic ? BASIC_BENEFITS : FREE_FEATURES).map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          {actError && <p className="text-sm text-destructive">{actError}</p>}

          {isBasic && (
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
          )}
        </CardContent>
      </Card>

      {/* Upgrade card — only shown to free users */}
      {!isBasic && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Upgrade to Basic
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-normal text-muted-foreground line-through">
                  $20
                </span>
                <span className="text-2xl font-bold">$10</span>
                <span className="text-sm font-normal text-muted-foreground">
                  /mo
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge
              variant="secondary"
              className="bg-amber-500/20 text-amber-200 border-amber-500/40"
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Launch pricing — 50% off
            </Badge>
            <ul className="space-y-2 text-sm">
              {BASIC_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

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
              Upgrade to Basic — $10/mo
              <span className="ml-2 text-xs opacity-70 line-through">$20</span>
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Subscriptions managed by Stripe. Cancel anytime — access continues
        until the end of the period.
      </p>
    </div>
  );
}
