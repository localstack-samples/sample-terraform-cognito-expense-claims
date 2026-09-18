import { useEffect, useRef, useState } from "react";
import { completeHostedUiSignIn, restoreHostedUiSession, signInWithHostedUi, signOutOfHostedUi } from "./auth/oidc";
import type { Session } from "./auth/session";
import { config } from "./config";
import { AdminSignInPage } from "./pages/AdminSignInPage";
import { ClaimsPage } from "./pages/ClaimsPage";
import { SecurityPage } from "./pages/SecurityPage";

type View = "claims" | "security" | "admin";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("claims");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);

  useEffect(() => {
    // React StrictMode runs effects twice in development; the code in the
    // callback URL can only be exchanged once, so guard the boot sequence.
    if (booted.current) return;
    booted.current = true;
    const boot = window.location.pathname === "/callback" ? completeHostedUiSignIn() : restoreHostedUiSession();
    boot
      .then((s) => s && setSession(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    if (session?.method === "hosted-ui") {
      await signOutOfHostedUi(); // redirects through Cognito's logout endpoint
    } else {
      setSession(null);
      setView("claims");
    }
  }

  return (
    <>
      <header>
        <h1>{config.appName}</h1>
        {session ? (
          <div className="identity">
            <span>
              {session.email}
              {session.groups.length > 0 && <span className="badge approved">{session.groups.join(", ")}</span>}
            </span>
            <button className="secondary" onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <div className="identity">
            <button onClick={() => signInWithHostedUi()}>Sign in with hosted UI</button>
            <button className="secondary" onClick={() => setView("admin")}>Finance admin sign-in</button>
          </div>
        )}
      </header>

      <main>
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !session && view !== "admin" && (
          <section className="card">
            <p>Submit and track expense claims. Sign in to get started.</p>
            <p className="muted">
              Employees use the Cognito hosted UI (authorization code + PKCE). Finance admins sign in with password + TOTP so approvals need a second factor.
            </p>
          </section>
        )}

        {!loading && !session && view === "admin" && (
          <AdminSignInPage
            onSignedIn={(s) => {
              setSession(s);
              setView("claims");
            }}
          />
        )}

        {session && (
          <>
            <nav>
              <button className={view === "claims" ? "active" : ""} onClick={() => setView("claims")}>Claims</button>
              <button className={view === "security" ? "active" : ""} onClick={() => setView("security")}>Security</button>
            </nav>
            {view === "security" ? <SecurityPage session={session} /> : <ClaimsPage session={session} />}
          </>
        )}
      </main>

      <footer className="muted">
        Issuer: <code>{config.issuer}</code>
      </footer>
    </>
  );
}
