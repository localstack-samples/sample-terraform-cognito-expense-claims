import { useState, type FormEvent } from "react";
import { answerTotpChallenge, signInWithPassword } from "../auth/cognito";
import type { Session } from "../auth/session";

// Password + TOTP sign-in against the Cognito API. Finance admins use this
// path because approving a claim should require the second factor.
export function AdminSignInPage({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ session: string; username: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPassword(email, password);
      if (result.kind === "signed-in") {
        // No MFA enrolled yet: Cognito issued tokens straight away.
        onSignedIn(result.session);
      } else if (result.kind === "totp-required") {
        setChallenge({ session: result.session, username: result.username });
      } else {
        setError(`Cognito asked for ${result.challenge}, which this app does not handle.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCode(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await answerTotpChallenge(challenge.session, challenge.username, code));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Finance admin sign-in</h2>
      <div className="card narrow">
        {!challenge ? (
          <form onSubmit={onPassword} className="stack">
            <p className="muted">Step 1 of 2: password (InitiateAuth, USER_PASSWORD_AUTH)</p>
            <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" disabled={busy}>Continue</button>
          </form>
        ) : (
          <form onSubmit={onCode} className="stack">
            <p className="muted">Step 2 of 2: authenticator code (RespondToAuthChallenge, SOFTWARE_TOKEN_MFA)</p>
            <input inputMode="numeric" pattern="[0-9]{6}" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            <button type="submit" disabled={busy}>Sign in</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
