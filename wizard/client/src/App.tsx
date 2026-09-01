import { Link, Route, Switch, useLocation } from "wouter";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Intake } from "./pages/Intake";
import { Campaign } from "./pages/Campaign";
import { WizardMark } from "./components/ui";

export function App() {
  return (
    <div className="min-h-screen" style={{ color: "var(--ink)" }}>
      {import.meta.env.VITE_SHOWROOM_MODE === "1" && (
        <div
          className="t-mono"
          style={{
            padding: "8px 20px",
            background: "var(--amber)",
            color: "#17130d",
            textAlign: "center",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Showroom mode · fictional data · external research services disconnected
        </div>
      )}
      <TopNav />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/settings" component={Settings} />
        <Route path="/campaign/:id/intake" component={Intake} />
        <Route path="/campaign/:id" component={Campaign} />
        <Route>
          <div className="max-w-2xl mx-auto px-6 py-20">
            <div className="section-mark mb-3">§ 404 / Not found</div>
            <h1
              className="t-display mb-3"
              style={{ fontSize: "clamp(28px, 4vw, 44px)" }}
            >
              No such page.
            </h1>
            <Link href="/" className="link-amber">
              ← Back to wizard home
            </Link>
          </div>
        </Route>
      </Switch>
    </div>
  );
}

function TopNav() {
  const [location] = useLocation();
  const isHome = location === "/";
  const isSettings = location === "/settings";
  return (
    <header className="nav-bar sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 no-underline"
          style={{ color: "var(--ink)" }}
        >
          <WizardMark size={22} />
          <span className="t-flourish" style={{ fontSize: 19 }}>
            Fractal&nbsp;Framework
          </span>
        </Link>
        <span
          className="hidden md:inline-block t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Wizard · v1
        </span>
        <div className="flex-1" />
        <nav className="flex gap-6 items-center">
          <Link
            href="/"
            className={`nav-link ${isHome ? "active" : ""}`.trim()}
          >
            Campaigns
          </Link>
          <Link
            href="/settings"
            className={`nav-link ${isSettings ? "active" : ""}`.trim()}
          >
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
}
