import { useCallback, useEffect, useState, type FormEvent } from "react";
import { approveClaim, listClaims, submitClaim, type Claim } from "../api";
import type { Session } from "../auth/session";

export function ClaimsPage({ session }: { session: Session }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listClaims(session.accessToken);
      setClaims(result.claims);
      setIsAdmin(result.viewer.groups.includes("finance-admins"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await submitClaim(session.accessToken, description, Number(amount));
      setDescription("");
      setAmount("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onApprove(id: string) {
    setBusy(true);
    try {
      await approveClaim(session.accessToken, id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Expense claims</h2>
      <p className="muted">
        {isAdmin ? "You are a finance admin and see every claim." : "You see the claims you submitted."}
      </p>

      <form className="card row" onSubmit={onSubmit}>
        <input placeholder="Description (e.g. Train to Berlin)" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <input placeholder="Amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <button type="submit" disabled={busy}>Submit claim</button>
      </form>

      {error && <p className="error">{error}</p>}

      <table className="card">
        <thead>
          <tr>
            <th>Description</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Submitted</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {claims.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No claims yet.</td>
            </tr>
          )}
          {claims.map((claim) => (
            <tr key={claim.id}>
              <td>{claim.description}</td>
              <td>{claim.amount.toFixed(2)}</td>
              <td>
                <span className={`badge ${claim.status}`}>{claim.status}</span>
              </td>
              <td>{new Date(claim.createdAt).toLocaleString()}</td>
              {isAdmin && (
                <td>
                  {claim.status === "submitted" && (
                    <button onClick={() => onApprove(claim.id)} disabled={busy}>Approve</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
