import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { associateSoftwareToken, getMfaStatus, totpUri, verifyAndEnableTotp, type MfaStatus } from "../auth/cognito";
import type { Session } from "../auth/session";

export function SecurityPage({ session }: { session: Session }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMfaStatus(session.accessToken).then(setStatus).catch((e) => setError((e as Error).message));
  }, [session.accessToken]);

  async function startEnrolment() {
    setError(null);
    try {
      // AssociateSoftwareToken returns a fresh base32 secret for this user.
      setSecret(await associateSoftwareToken(session.accessToken));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finishEnrolment(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // VerifySoftwareToken proves the app generates matching codes;
      // SetUserMFAPreference makes TOTP the preferred factor.
      await verifyAndEnableTotp(session.accessToken, code);
      setMessage("Authenticator verified. TOTP is now required when you sign in with your password.");
      setSecret(null);
      setCode("");
      setStatus(await getMfaStatus(session.accessToken));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section>
      <h2>Security</h2>
      <div className="card">
        <p>
          Signed in as <strong>{session.email}</strong> via {session.method === "hosted-ui" ? "the hosted UI" : "password + TOTP"}.
        </p>
        <p>
          Multi-factor authentication:{" "}
          {status === null ? "checking…" : status.enabled ? <span className="badge approved">TOTP enabled</span> : <span className="badge submitted">not set up</span>}
        </p>

        {!secret && (
          <button onClick={startEnrolment}>{status?.enabled ? "Register a new authenticator" : "Set up an authenticator app"}</button>
        )}

        {secret && (
          <form className="enrol" onSubmit={finishEnrolment}>
            <p>Scan the QR code with Google Authenticator, 1Password or any TOTP app, then enter the six-digit code it shows.</p>
            <QRCodeSVG value={totpUri(secret, session.email)} size={180} marginSize={2} />
            <p className="muted">
              No phone at hand? Secret: <code>{secret}</code>
              <br />
              <code>npm run totp -- {secret}</code>
            </p>
            <div className="row">
              <input inputMode="numeric" pattern="[0-9]{6}" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
              <button type="submit">Verify and enable</button>
            </div>
          </form>
        )}

        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
