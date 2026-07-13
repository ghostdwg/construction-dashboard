"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/bids";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/setup");
        if (!res.ok) { setMode("login"); return; }
        const data = (await res.json()) as { hasUsers: boolean };
        if (cancelled) return;
        setMode(data.hasUsers ? "login" : "setup");
      } catch {
        if (!cancelled) setMode("login");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "setup") {
        const res = await fetch("/api/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
      }
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (result?.error) { setError("Invalid email or password."); setLoading(false); return; }
      router.push(callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  if (mode === "loading") {
    return (
      <div style={styles.fullscreen}>
        <p style={{ fontSize: 13, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
          Loading…
        </p>
      </div>
    );
  }

  const isSetup = mode === "setup";

  return (
    <div style={styles.fullscreen}>
      {/* Blueprint grid background */}
      <div style={styles.blueprintGrid} aria-hidden />
      {/* Blue radial glow behind card */}
      <div style={styles.glow} aria-hidden />

      <div style={styles.card}>
        {/* Brand header */}
        <div style={styles.brandRow}>
          <span style={styles.brandNeuro}>NEURO | GLITCH</span>
          <span style={styles.brandSep}>·</span>
          <span style={styles.brandGw}>GroundWorX</span>
        </div>

        {/* Heading */}
        <div style={styles.headingBlock}>
          <h1 style={styles.heading}>
            {isSetup ? "Create Admin Account" : "Login to GroundWorX"}
          </h1>
          <p style={styles.subheading}>
            {isSetup
              ? "No accounts exist yet. Create the first admin account."
              : "Construction intelligence from bid to closeout."}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {isSetup && (
            <div style={styles.field}>
              <label style={styles.label}>Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                autoFocus
                style={styles.input}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border-accent)")}
              />
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              required
              autoFocus={!isSetup}
              style={styles.input}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border-accent)")}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSetup ? "Choose a strong password" : "••••••••"}
              required
              minLength={8}
              style={styles.input}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border-accent)")}
            />
            {isSetup && (
              <p style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 6 }}>
                Minimum 8 characters.
              </p>
            )}
          </div>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitBtn,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = "var(--color-accent-hover)";
                e.currentTarget.style.boxShadow = "0 0 24px var(--color-accent-glow-strong)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-accent)";
              e.currentTarget.style.boxShadow = "0 0 16px var(--color-accent-glow)";
            }}
          >
            {loading ? "Please wait…" : isSetup ? "Create Account & Sign In" : "Sign In →"}
          </button>
        </form>

        {/* Attribution */}
        <p style={styles.attribution}>by NEURO | GLITCH</p>
      </div>
    </div>
  );
}

const styles = {
  fullscreen: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg-base)",
    position: "relative" as const,
    overflow: "hidden",
    padding: "24px",
    boxSizing: "border-box" as const,
  },
  blueprintGrid: {
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "none" as const,
    backgroundImage: [
      "linear-gradient(rgba(45,123,255,0.06) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(45,123,255,0.06) 1px, transparent 1px)",
      "linear-gradient(rgba(45,123,255,0.025) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(45,123,255,0.025) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: "80px 80px, 80px 80px, 16px 16px, 16px 16px",
    maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black 30%, transparent 100%)",
    WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black 30%, transparent 100%)",
  },
  glow: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -60%)",
    width: 600,
    height: 400,
    background: "radial-gradient(ellipse at center, rgba(45,123,255,0.1) 0%, transparent 70%)",
    pointerEvents: "none" as const,
  },
  card: {
    position: "relative" as const,
    zIndex: 1,
    width: "100%",
    maxWidth: 380,
    boxSizing: "border-box" as const,
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-accent)",
    borderRadius: 12,
    padding: "36px 32px",
    boxShadow: "0 0 0 1px rgba(45,123,255,0.1), 0 0 40px rgba(45,123,255,0.08), 0 24px 48px rgba(0,0,0,0.4)",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 28,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.08em",
  },
  brandNeuro: {
    color: "var(--color-text-dim)",
    fontWeight: 300,
  },
  brandSep: {
    color: "var(--color-border-accent)",
  },
  brandGw: {
    color: "var(--color-text-primary)",
    fontWeight: 500,
  },
  headingBlock: {
    marginBottom: 28,
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--color-text-primary)",
    marginBottom: 6,
  },
  subheading: {
    fontSize: 13,
    color: "var(--color-text-secondary)",
    lineHeight: 1.5,
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--color-text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  input: {
    width: "100%",
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-accent)",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 14,
    color: "var(--color-text-primary)",
    outline: "none",
    transition: "border-color 0.15s",
  },
  errorBox: {
    background: "var(--color-danger-bg)",
    border: "1px solid var(--color-danger)",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--color-danger)",
  },
  submitBtn: {
    width: "100%",
    background: "var(--color-accent)",
    color: "#0A0E1A",
    fontWeight: 600,
    fontSize: 14,
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    boxShadow: "0 0 16px var(--color-accent-glow)",
    transition: "background 0.15s, box-shadow 0.15s, transform 0.1s",
    marginTop: 4,
  },
  attribution: {
    marginTop: 24,
    textAlign: "center" as const,
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--color-text-dim)",
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase" as const,
  },
} as const;

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg-base)" }}>
        <p style={{ fontSize: 13, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>Loading…</p>
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
