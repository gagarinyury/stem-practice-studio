"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { BottomNav } from "./BottomNav";

const PUBLIC_PATHS = ["/login"];

/**
 * Top-level wrapper. Routes under PUBLIC_PATHS render directly; everything
 * else is gated behind AuthGuard (client-side redirect on missing token).
 * BottomNav decides its own visibility based on pathname.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isPublic) return <>{children}</>;
  return (
    <AuthGuard>
      {children}
      <BottomNav />
    </AuthGuard>
  );
}
