// Camera tracker debug dashboard: video + overlays on the left, sky plot and
// target list on the right, jog / calibration / config along the bottom.

import { useState } from "react";
import { useTracker } from "./useTracker.js";
import { CalibrationWizard } from "./components/CalibrationWizard.js";
import { ConfigPanel } from "./components/ConfigPanel.js";
import { JogPad } from "./components/JogPad.js";
import { RecordPanel } from "./components/RecordPanel.js";
import { SkyPolar } from "./components/SkyPolar.js";
import { StatusBar } from "./components/StatusBar.js";
import { TargetTable } from "./components/TargetTable.js";
import { VideoPane } from "./components/VideoPane.js";

function IdentityTarget({ onTrack }: { onTrack: (identity: string | null) => void }) {
  const [identity, setIdentity] = useState("");

  return (
    <form
      className="identity-target"
      onSubmit={(event) => {
        event.preventDefault();
        onTrack(identity.trim() || null);
      }}
    >
      <label>
        <span>Track flight or tail</span>
        <input
          value={identity}
          onChange={(event) => setIdentity(event.target.value)}
          placeholder="AC1664"
          aria-label="Track by callsign, flight number, or tail number"
        />
      </label>
      <button type="submit">Track</button>
      <button type="button" onClick={() => { setIdentity(""); onTrack(null); }}>Release</button>
    </form>
  );
}

export function Tracker() {
  const { stream, conn } = useTracker();
  const { state, config } = stream;

  if (!state || !config) {
    return (
      <div className="loading">
        <div className={`dot ${stream.connected ? "ok" : "bad"}`} />
        {stream.connected ? "waiting for tracker state…" : "connecting to tracker…"}
      </div>
    );
  }

  const pick = (hex: string | null) => conn.send({ type: "manualTarget", hex });

  return (
    <div className="tracker">
      <StatusBar state={state} connected={stream.connected} conn={conn} />

      <main className="layout">
        <section className="left">
          <VideoPane state={state} config={config} connected={stream.connected} />
          <RecordPanel state={state} connected={stream.connected} />
          <div className="bottom-row">
            <JogPad conn={conn} />
            {state.mode === "calibrate" ? (
              <CalibrationWizard state={state} conn={conn} />
            ) : (
              <ConfigPanel config={config} conn={conn} />
            )}
          </div>
        </section>

        <aside className="right">
          <SkyPolar state={state} config={config} onPick={(hex) => pick(hex)} />
          <IdentityTarget
            onTrack={(value) => conn.send({ type: "manualTargetByIdentity", identity: value })}
          />
          <TargetTable state={state} onPick={pick} />
        </aside>
      </main>
    </div>
  );
}
