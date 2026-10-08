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
const demoUserMeta: Record<string, { name: string; avatar: string }> = {
  "anna.wave": { name: "Anna", avatar: "/demo-avatars/anna.jpg" },
  "max.creates": { name: "Max", avatar: "/demo-avatars/max.jpg" },
  "dasha.sun": { name: "Dasha", avatar: "/demo-avatars/dasha.jpg" },
  "nikita.film": { name: "Nikita", avatar: "/demo-avatars/nikita.jpg" },
  "alina.space": { name: "Alina", avatar: "/demo-avatars/alina.jpg" },
  "kirill.design": { name: "Kirill", avatar: "/demo-avatars/kirill.jpg" },
  "polina.notes": { name: "Polina", avatar: "/demo-avatars/polina.jpg" },
  "elena.studio": { name: "Elena", avatar: "/demo-avatars/elena.jpg" },
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
  full_name: demoUserMeta[username]?.name,
  avatar_url: demoUserMeta[username]?.avatar,
  favorite: i === 2,
  note: i === 2 ? "Знакомы по дизайн-сообществу" : "",
}));
export const demoEvents: Event[] = demoPeople.slice(0, 5).map((x, i) => ({
  ...x,
  id: `demo-event-${i}`,
  relation: "followers",
  type: i % 2 ? "added" : "removed",
}));
const historyCounts = [
  { followers: 1160, following: 810, newCount: 0 },
  { followers: 1173, following: 813, newCount: 10 },
  { followers: 1186, following: 816, newCount: 10 },
  { followers: 1199, following: 825, newCount: 10 },
  { followers: 1212, following: 822, newCount: 10 },
  { followers: 1225, following: 825, newCount: 10 },
  { followers: 1240, following: 828, newCount: 12 },
];

export const demoHistory: Snapshot[] = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  source: "instagrapi",
  observed_at: `2024-10-${String(i + 1).padStart(2, "0")}T13:00:00Z`,
  created_at: `2024-10-${String(i + 1).padStart(2, "0")}T13:00:00Z`,
  completeness: "collection_validated",
  identity_mode: "stable_id",
  checksum: "synthetic-demo",
  provenance: { demo: true, new_followers_count: historyCounts[i].newCount },
  storage_bytes: 0,
  counts: {
    ...demoCounts,
    followers: historyCounts[i].followers,
    following: historyCounts[i].following,
  },
}));
export const demoSummary: Summary = {
  profile: demoProfile,
  snapshot: demoHistory[6],
  counts: demoCounts,
  changes: demoEvents,
  previous_snapshot: demoHistory[5],
};
