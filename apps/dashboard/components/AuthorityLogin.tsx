"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, Headset, LoaderCircle, Radio, ShieldCheck } from "lucide-react";
import { loginAuthorityRole, type AuthoritySession, type AuthorityUser } from "@/lib/api";
import styles from "./AuthorityLogin.module.css";

type Role = AuthorityUser["role"];

const roles: Array<{ role: Role; title: string; description: string; destination: string; Icon: typeof ShieldCheck }> = [
  { role: "admin", title: "Admin", description: "Verify incidents, publish alerts and coordinate the full response.", destination: "Open command overview", Icon: ShieldCheck },
  { role: "responder", title: "Responder", description: "See assigned emergencies, update field status and share operational notes.", destination: "Open SOS desk", Icon: Headset },
];

export default function AuthorityLogin({ onAuthenticated }: { onAuthenticated: (session: AuthoritySession) => void }) {
  const [busyRole, setBusyRole] = useState<Role | null>(null);
  const [error, setError] = useState("");

  async function chooseRole(role: Role) {
    setBusyRole(role);
    setError("");
    try {
      onAuthenticated(await loginAuthorityRole(role));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The command centre is unavailable. Check the backend and try again.");
      setBusyRole(null);
    }
  }

  return <main className={styles.shell}>
    <section className={styles.context} aria-label="BEACON command centre">
      <div className={styles.brand}><span className={styles.mark}><Radio aria-hidden="true" /></span>BEACON</div>
      <div className={styles.statement}><h1>A clear operating picture, when it matters.</h1><p>Review citizen evidence, coordinate response and publish verified guidance from one auditable command centre.</p></div>
      <div className={styles.status}><span aria-hidden="true" />Live authority network</div>
    </section>

    <section className={styles.entry} aria-labelledby="role-title">
      <div className={styles.panel}>
        <header><h2 id="role-title">How are you joining?</h2><p>Select your role to open the right operational workspace.</p></header>
        <div className={styles.roleList}>
          {roles.map(({ role, title, description, destination, Icon }) => {
            const busy = busyRole === role;
            return <button key={role} className={styles.roleChoice} type="button" disabled={busyRole !== null} onClick={() => chooseRole(role)} aria-label={`Continue as ${title}`}>
              <span className={styles.roleIcon}>{busy ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
              <span className={styles.roleCopy}><strong>{busy ? `Opening ${title}…` : title}</strong><small>{description}</small><em>{destination}</em></span>
              <ArrowRight className={styles.arrow} aria-hidden="true" />
            </button>;
          })}
        </div>
        {error && <p className={styles.error} role="alert"><AlertCircle aria-hidden="true" />{error}</p>}
        <p className={styles.assurance}><ShieldCheck aria-hidden="true" />Demo access only. Every authority action remains recorded in the audit trail.</p>
      </div>
    </section>
  </main>;
}
