"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { submitLogin } from "./utils";

const SSO_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  state_mismatch: "Your sign-in session expired. Please try again.",
  exchange_failed: "Could not complete sign-in with your identity provider. Please try again.",
  email_unverified: "Your identity provider has not verified your email address.",
  no_account: "This account is not available. Contact your administrator.",
  domain_not_allowed: "This account is not available. Contact your administrator.",
  group_missing: "This account is not available. Contact your administrator.",
  account_disabled: "This account is not available. Contact your administrator.",
};

export function LoginClient({
  ssoEnabled,
  ssoLabel,
  passwordLoginEnabled,
}: {
  ssoEnabled: boolean;
  ssoLabel: string;
  passwordLoginEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ssoError = searchParams.get("sso_error");
  const [error, setError] = useState<string | null>(
    ssoError ? (SSO_ERRORS[ssoError] ?? "Single sign-on failed. Please try again.") : null,
  );
  const [loading, setLoading] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { ok, data } = await submitLogin(new FormData(e.currentTarget));
      if (!ok) {
        setError(data.error ?? "Login failed");
        setTurnstileReset((value) => value + 1);
        return;
      }
      router.replace(data.redirect ?? "/inbox");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Login timed out. Please try again."
          : "Unable to reach the login service. Please try again.",
      );
      setTurnstileReset((value) => value + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      icon={Mail}
      title="Sign in"
      description="Open your mailbox and continue from the same inbox workspace."
    >
      {error && (
        <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {passwordLoginEnabled && (
        <form method="post" onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <TurnstileField resetSignal={turnstileReset} />
          <Button
            type="submit"
            className="h-11 w-full rounded-full px-6 active:scale-[0.98]"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      )}
      {ssoEnabled && (
        <div className={passwordLoginEnabled ? "mt-5 space-y-5" : "space-y-5"}>
          {passwordLoginEnabled && (
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-neutral-400">
              <span className="h-px flex-1 bg-neutral-200" />
              or
              <span className="h-px flex-1 bg-neutral-200" />
            </div>
          )}
          <Button
            asChild
            variant="outline"
            className="h-11 w-full rounded-full px-6 active:scale-[0.98]"
          >
            <a href="/api/auth/oidc/start">{ssoLabel}</a>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
