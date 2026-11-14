export class Audio {
  muted = false;
  private context?: AudioContext;
  play(kind: "hit" | "fire" | "level" | "loot" | "frost") {
    if (this.muted) return;
    this.context ??= new AudioContext();
    void this.context.resume();
    const c = this.context;
    const notes =
      kind === "level"
        ? [523, 659, 784, 1046]
        : kind === "loot"
          ? [880, 1320]
          : kind === "fire"
            ? [140, 60]
            : kind === "frost"
              ? [1200, 600]
              : [220, 85];
    notes.forEach((freq, i) => {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = kind === "hit" ? "triangle" : "sine";
      o.frequency.setValueAtTime(freq, c.currentTime + i * 0.08);
      g.gain.setValueAtTime(0.055, c.currentTime + i * 0.08);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        c.currentTime + i * 0.08 + 0.22,
      );
      o.connect(g);
      g.connect(c.destination);
      o.start(c.currentTime + i * 0.08);
      o.stop(c.currentTime + i * 0.08 + 0.24);
    });
  }
  dispose() {
    void this.context?.close();
  }
}
