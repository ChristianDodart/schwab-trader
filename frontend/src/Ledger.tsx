import { useState } from "react";
import { SubTabs } from "./LedgerUI";
import { LedgerHistoric } from "./LedgerHistoric";
import { LedgerActivity } from "./LedgerActivity";
import { LedgerPredictive } from "./LedgerPredictive";
import { LedgerTrades } from "./LedgerTrades";

type Tab = "historic" | "activity" | "trades" | "predictive";

// The ledger splits FACT from PREDICTION so the two never blur together:
//   Historic  — observed truth (Schwab balances + realized gains + deposits)
//   Trades    — the closed-round-trip journal + performance analytics
//   Predictive — math on top of history (goal pacing, EOY projection, estimated taxes)
export function Ledger() {
  const [tab, setTab] = useState<Tab>("historic");
  return (
    <div>
      <h2 className="page-title" style={{ marginTop: 4 }}>Ledger</h2>
      <SubTabs
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: "historic", label: "Historic", hint: "Observed facts — balances, realized gains, deposits" },
          { id: "activity", label: "Activity", hint: "Dollars bought and sold by day, week, month, or year" },
          { id: "trades", label: "Trades", hint: "Every closed trade + win rate, profit factor, hold time" },
          { id: "predictive", label: "Predictive", hint: "Projections — goal pacing, year-end gains, estimated taxes" },
        ]}
      />
      <div id={`${tab}-panel`} role="tabpanel" aria-labelledby={`${tab}-tab`}>
        {tab === "historic" ? <LedgerHistoric /> : tab === "activity" ? <LedgerActivity /> : tab === "trades" ? <LedgerTrades /> : <LedgerPredictive />}
      </div>
    </div>
  );
}
