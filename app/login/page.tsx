"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

// ── Design tokens (matching neuroglitch.ai landing) ──────────────────────────
const BG        = "#0A0E1A";
const ACCENT    = "#2D7BFF";
const SURFACE   = "rgba(255,255,255,0.03)";
const BORDER    = "rgba(45,123,255,0.22)";
const GLOW      = "rgba(45,123,255,0.18)";
const MUTED     = "rgba(255,255,255,0.42)";
const DIM       = "rgba(255,255,255,0.18)";
const MONO      = "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace";

// ── Blueprint grid + glow injected once ─────────────────────────────────────
const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');

  body { background: ${BG}; margin: 0; }

  .gwx-login-grid {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background-image:
      linear-gradient(rgba(45,123,255,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(45,123,255,0.06) 1px, transparent 1px),
      linear-gradient(rgba(45,123,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(45,123,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px, 60px 60px, 12px 12px, 12px 12px;
    mask-image: radial-gradient(ellipse 90% 90% at 50% 40%, black 30%, transparent 100%);
    -webkit-mask-image: radial-gradient(ellipse 90% 90% at 50% 40%, black 30%, transparent 100%);
  }

  .gwx-login-glow {
    position: fixed;
    top: -10%;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    height: 400px;
    background: radial-gradient(ellipse at center, rgba(45,123,255,0.10) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
  }

  .gwx-login-input {
    width: 100%;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 14px;
    color: #fff;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-sizing: border-box;
    font-family: inherit;
  }
  .gwx-login-input::placeholder { color: rgba(255,255,255,0.25); }
  .gwx-login-input:focus {
    border-color: ${ACCENT};
    box-shadow: 0 0 0 3px rgba(45,123,255,0.15);
  }

  .gwx-login-btn {
    width: 100%;
    background: ${ACCENT};
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 11px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: background 0.15s, box-shadow 0.15s, opacity 0.15s;
    font-family: inherit;
  }
  .gwx-login-btn:hover:not(:disabled) {
    background: #3d88ff;
    box-shadow: 0 0 18px rgba(45,123,255,0.45);
  }
  .gwx-login-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .gwx-login-label {
    display: block;
    font-family: ${MONO};
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${MUTED};
    margin-bottom: 5px;
  }
`;

function LoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get("callbackUrl") ?? "/bids";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [name,     setName]     = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [mode,     setMode]     = useState<"loading" | "setup" | "login">("loading");

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
          const err = await res.json().catch(() => ({})) as { error?: string };
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

  const isSetup = mode === "setup";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_STYLES }} />
      <div className="gwx-login-grid" />
      <div className="gwx-login-glow" />

      <div style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "'Inter', sans-serif",
        background: BG,
      }}>
        {mode === "loading" ? (
          <p style={{ fontFamily: MONO, fontSize: 12, color: DIM, letterSpacing: "0.06em" }}>
            INITIALIZING…
          </p>
        ) : (
          <div style={{
            width: "100%",
            maxWidth: 420,
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "40px 36px 36px",
            boxShadow: `0 0 0 1px rgba(45,123,255,0.08), 0 8px 48px rgba(0,0,0,0.5), 0 0 60px ${GLOW}`,
            backdropFilter: "blur(8px)",
          }}>

            {/* Brand label */}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <p style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: DIM,
                marginBottom: 10,
              }}>
                NEURO{" "}
                <span style={{ color: "rgba(255,255,255,0.08)", margin: "0 2px" }}>|</span>
                {" "}GLITCH
              </p>
              <h1 style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#fff",
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                margin: "0 0 8px",
              }}>
                GroundWorX
              </h1>
              <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                {isSetup
                  ? "Create the first admin account to continue"
                  : "Sign in to continue"}
              </p>
            </div>

            {/* Divider */}
            <div style={{
              height: 1,
              background: "linear-gradient(90deg, transparent, rgba(45,123,255,0.25), transparent)",
              marginBottom: 28,
            }} />

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {isSetup && (
                <div>
                  <label className="gwx-login-label">Your Name</label>
                  <input
                    type="text"
                    className="gwx-login-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                    autoFocus
                  />
                </div>
              )}
              <div>
                <label className="gwx-login-label">Email</label>
                <input
                  type="email"
                  className="gwx-login-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  required
                  autoFocus={!isSetup}
                />
              </div>
              <div>
                <label className="gwx-login-label">Password</label>
                <input
                  type="password"
                  className="gwx-login-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetup ? "Choose a strong password" : "••••••••"}
                  required
                  minLength={8}
                />
                {isSetup && (
                  <p style={{ fontSize: 11, color: DIM, marginTop: 4, fontFamily: MONO }}>
                    Minimum 8 characters.
                  </p>
                )}
              </div>

              {error && (
                <div style={{
                  borderRadius: 6,
                  border: "1px solid rgba(255,100,80,0.3)",
                  background: "rgba(255,60,60,0.08)",
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#ff968f",
                  fontFamily: MONO,
                  letterSpacing: "0.02em",
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="gwx-login-btn"
                disabled={loading}
                style={{ marginTop: 4 }}
              >
                {loading
                  ? "Please wait…"
                  : isSetup
                  ? "Create Account & Sign In"
                  : "Sign In →"}
              </button>
            </form>

            {/* Footer */}
            <p style={{
              textAlign: "center",
              fontSize: 11,
              color: DIM,
              marginTop: 24,
              marginBottom: 0,
              fontFamily: MONO,
              letterSpacing: "0.04em",
            }}>
              CONSTRUCTION INTELLIGENCE PLATFORM
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
        fontFamily: MONO,
        fontSize: 12,
        color: DIM,
        letterSpacing: "0.06em",
      }}>
        INITIALIZING…
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
