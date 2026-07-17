/**
 * AzA · Targets — a command surface over the harness `Target` shape
 * (target leads). Built on the canonical AzA design system
 * (Th3Sp3ct3R/AzA-Design-System): monochrome, blueprint geometry, mono badges,
 * white-primary action. Scoped under `.aza` — never touches the Ares shell.
 *
 * SECURITY: username/fullName are untrusted IG text — inert React text nodes only.
 */
import { useMemo, useState } from "react";
import "./aza.css";

/** Mirror of @ares/harness Target (kept local to avoid a cross-package dep). */
export interface AzaTarget {
  igId: string;
  username: string;
  fullName?: string;
  followerCount?: number;
  isVerified?: boolean;
  category?: string;
  country?: string;
  email?: string;
}

export interface TargetsQuery {
  metaCategory?: string;
  country?: string;
  minFollowers?: number;
}

export interface TargetsPanelProps {
  targets: AzaTarget[];
  busy?: boolean;
  onSearch?: (q: TargetsQuery) => void;
}

const fmt = (n?: number) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export function TargetsPanel({ targets, busy = false, onSearch }: TargetsPanelProps) {
  const [metaCategory, setMetaCategory] = useState("music");
  const [country, setCountry] = useState("United States");
  const [minFollowers, setMinFollowers] = useState("10000");

  const stats = useMemo(() => {
    const verified = targets.filter((t) => t.isVerified).length;
    const withEmail = targets.filter((t) => t.email).length;
    return { total: targets.length, verified, withEmail };
  }, [targets]);

  const run = () =>
    onSearch?.({
      metaCategory: metaCategory || undefined,
      country: country || undefined,
      minFollowers: minFollowers ? Number(minFollowers) : undefined,
    });

  return (
    <div className="aza control-shell">
      <nav className="control-rail" aria-label="AzA">
        <div className="brand-mark">AzA</div>
        <button title="Targets" aria-current="page">◎</button>
        <button title="Sources">▤</button>
        <button title="Runs">▷</button>
        <button title="Settings">⚙</button>
      </nav>

      <div className="control-workspace">
        <header className="control-topbar">
          <div>
            <p className="aza-label">AzA · Targets</p>
            <h1>Targets</h1>
          </div>
          <div className="topbar-actions">
            <button className="aza-button aza-button-primary" onClick={run} disabled={busy}>
              {busy ? "Scanning…" : "Collect"}
            </button>
          </div>
        </header>

        <section className="metrics-grid">
          <div className="aza-metric-card"><div><span className="aza-badge">Leads</span><strong>{stats.total}</strong><span>in pool</span></div></div>
          <div className="aza-metric-card"><div><span className="aza-badge">Verified</span><strong>{stats.verified}</strong><span>badged accounts</span></div></div>
          <div className="aza-metric-card"><div><span className="aza-badge">Email</span><strong>{stats.withEmail}</strong><span>contactable</span></div></div>
          <div className="aza-metric-card"><div><span className="aza-badge-strong aza-badge">Zero burn</span><strong>0</strong><span>accounts risked</span></div></div>
        </section>

        <section className="aza-card blueprint">
          <h3>Query</h3>
          <div className="form-line">
            <div className="field">
              <label htmlFor="aza-cat">Category</label>
              <input id="aza-cat" value={metaCategory} onChange={(e) => setMetaCategory(e.target.value)} placeholder="music" />
            </div>
            <div className="field">
              <label htmlFor="aza-country">Country</label>
              <input id="aza-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" />
            </div>
            <div className="field">
              <label htmlFor="aza-min">Min followers</label>
              <input id="aza-min" value={minFollowers} inputMode="numeric"
                onChange={(e) => setMinFollowers(e.target.value.replace(/[^0-9]/g, ""))} placeholder="10000" />
            </div>
            <button className="aza-button" onClick={run} disabled={busy}>Run query</button>
          </div>

          {targets.length === 0 ? (
            <div className="empty-state">
              <div className="brand-mark">AzA</div>
              <p>No targets yet. Run a query to collect leads.</p>
            </div>
          ) : (
            <div className="status-table">
              <div className="data-row head">
                <span>User</span><span>Followers</span><span>Category</span><span>Country</span><span>Email</span>
              </div>
              {targets.map((t) => (
                <div className="data-row" key={t.igId}>
                  <strong>@{t.username}{t.isVerified && <span className="verified" title="verified"> ✦</span>}</strong>
                  <code>{fmt(t.followerCount)}</code>
                  <span>{t.category ? <span className="aza-badge aza-badge-muted">{t.category}</span> : <code>—</code>}</span>
                  <code>{t.country ?? "—"}</code>
                  <code>{t.email ?? "—"}</code>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="footer-line">
          <span className="dot" />
          <span>zero account burn · {stats.total} leads</span>
        </footer>
      </div>
    </div>
  );
}
