import type { Counts, Profile, Summary, Person, Snapshot, Event } from "./api";
export const demoProfile: Profile = {
  id: "demo",
  username: "your.circle",
  label: "Демо",
  interval_hours: 24,
  status: "active",
  paused: false,
  last_sync: "2026-10-07T10:00:00Z",
  next_sync: "2026-10-08T10:00:00Z",
  cooldown_until: null,
};
export const demoCounts: Counts = {
  followers: 1240,
  following: 830,
  mutual: 612,
  fans: 628,
  not_following_back: 218,
  mutual_rate: 49.4,
};
export const demoPeople: Person[] = [
  "anna.wave",
  "max.creates",
  "dasha.sun",
  "nikita.film",
  "alina.space",
  "kirill.design",
  "polina.notes",
  "elena.studio",
].map((username, i) => ({
  identity_key: String(i),
  username,
  favorite: i === 2,
  note: i === 2 ? "Знакомы по дизайн-сообществу" : "",
}));
export const demoEvents: Event[] = demoPeople.slice(0, 5).map((x, i) => ({
  ...x,
  id: `demo-event-${i}`,
  relation: "followers",
  type: i % 2 ? "added" : "removed",
}));
export const demoHistory: Snapshot[] = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  source: "instagrapi",
  observed_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  created_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  completeness: "collection_validated",
  identity_mode: "stable_id",
  checksum: "synthetic-demo",
  provenance: { demo: true },
  storage_bytes: 0,
  counts: {
    ...demoCounts,
    followers: 1160 + i * 13 + (i === 6 ? 2 : 0),
    following: 810 + i * 3,
  },
}));
export const demoSummary: Summary = {
  profile: demoProfile,
  snapshot: demoHistory[6],
  counts: demoCounts,
  changes: demoEvents,
  previous_snapshot: demoHistory[5],
};
