// Firestore client — talks directly from the device to Google Firestore.
// These web-config values are public by design (they ship in your JS bundle);
// security is enforced by Firestore Security Rules in the Firebase console.

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyARdTeJmw4MbA__nwIrbOE19IX2VZQ-Sbs",
  authDomain: "hayden-job-tracker.firebaseapp.com",
  projectId: "hayden-job-tracker",
  storageBucket: "hayden-job-tracker.firebasestorage.app",
  messagingSenderId: "111276656034",
  appId: "1:111276656034:web:014a041fb8615fc0619efb",
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);
// Named database (created in GCP console as "haydens-job-tracker" rather than
// the auto "(default)"). Pass the id as the 2nd arg to getFirestore.
export const db = getFirestore(app, "haydens-job-tracker");

// ---- Domain --------------------------------------------------------------
export const USER_ANDREWS = "Hayden Andrews";
export const USER_BONE = "Hayden Bone";

export const SERVICES = [
  "Picture Framing",
  "Large Format Printing",
  "Large Format Scanning",
] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_OWNER: Record<Service, string> = {
  "Picture Framing": USER_ANDREWS,
  "Large Format Printing": USER_ANDREWS,
  "Large Format Scanning": USER_BONE,
};

const WHOLESALE_DISCOUNT = 20;

export type Job = {
  id: string;
  user: string;
  service: Service;
  base_price: number;
  discount_percent: number;
  final_cost: number;
  notes: string;
  date: string; // ISO
  month: string; // YYYY-MM
  archived: boolean;
};

export type Summary = {
  month: string;
  total_andrews: number;
  total_bone: number;
  net_balance: number;
  debtor: string | null;
  creditor: string | null;
  job_count: number;
};

export const computeDiscount = (user: string, service: Service): number =>
  SERVICE_OWNER[service] === user ? 0 : WHOLESALE_DISCOUNT;

export const monthKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Firestore ops -------------------------------------------------------
const JOBS = "jobs";

export async function createJob(input: {
  user: string;
  service: Service;
  base_price: number;
  notes?: string;
}): Promise<Job> {
  const ref = doc(collection(db, JOBS));
  const discount = computeDiscount(input.user, input.service);
  const final = round2(input.base_price * (1 - discount / 100));
  const now = new Date();
  const job: Job = {
    id: ref.id,
    user: input.user,
    service: input.service,
    base_price: round2(input.base_price),
    discount_percent: discount,
    final_cost: final,
    notes: (input.notes ?? "").trim(),
    date: now.toISOString(),
    month: monthKey(now),
    archived: false,
  };
  await setDoc(ref, job);
  return job;
}

export async function listJobs(opts: {
  month?: string;
  includeArchived?: boolean;
}): Promise<Job[]> {
  const clauses = [];
  if (opts.month) clauses.push(where("month", "==", opts.month));
  if (!opts.includeArchived) clauses.push(where("archived", "==", false));
  // We do NOT add orderBy in Firestore because mixing where(archived) +
  // orderBy(date) would require a composite index. We sort in memory.
  const q = clauses.length
    ? query(collection(db, JOBS), ...clauses)
    : query(collection(db, JOBS));
  const snap = await getDocs(q);
  const rows: Job[] = [];
  snap.forEach((d) => rows.push(d.data() as Job));
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

export async function deleteJob(id: string): Promise<void> {
  await deleteDoc(doc(db, JOBS, id));
}

export async function archiveMonth(month: string): Promise<number> {
  const q = query(
    collection(db, JOBS),
    where("month", "==", month),
    where("archived", "==", false),
  );
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.update(d.ref, { archived: true }));
  await batch.commit();
  return snap.size;
}

export async function getSummary(month: string): Promise<Summary> {
  const rows = await listJobs({ month, includeArchived: false });
  const total_andrews = round2(
    rows.filter((r) => r.user === USER_ANDREWS).reduce((s, r) => s + r.final_cost, 0),
  );
  const total_bone = round2(
    rows.filter((r) => r.user === USER_BONE).reduce((s, r) => s + r.final_cost, 0),
  );
  const diff = round2(total_andrews - total_bone);
  let debtor: string | null = null;
  let creditor: string | null = null;
  let net = 0;
  if (Math.abs(diff) >= 0.005) {
    if (diff > 0) {
      debtor = USER_ANDREWS;
      creditor = USER_BONE;
    } else {
      debtor = USER_BONE;
      creditor = USER_ANDREWS;
    }
    net = Math.abs(diff);
  }
  return {
    month,
    total_andrews,
    total_bone,
    net_balance: round2(net),
    debtor,
    creditor,
    job_count: rows.length,
  };
}

export async function listMonths(): Promise<string[]> {
  const snap = await getDocs(collection(db, JOBS));
  const set = new Set<string>();
  snap.forEach((d) => {
    const m = (d.data() as Job).month;
    if (m) set.add(m);
  });
  set.add(monthKey()); // always include current month
  return Array.from(set).sort().reverse();
}

// ---- CSV export ----------------------------------------------------------
function escapeCsvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function jobsToCsv(rows: Job[]): string {
  const header = [
    "Date",
    "Month",
    "User",
    "Service",
    "Base Price",
    "Discount %",
    "Final Cost",
    "Job Name",
    "Archived",
    "ID",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.month,
        r.user,
        r.service,
        r.base_price.toFixed(2),
        r.discount_percent.toFixed(2),
        r.final_cost.toFixed(2),
        r.notes,
        r.archived ? "yes" : "no",
        r.id,
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function exportCsv(scope: string): Promise<{ filename: string; csv: string }> {
  // scope === "all" or "YYYY-MM"
  let rows: Job[];
  if (scope === "all") {
    const snap = await getDocs(collection(db, JOBS));
    rows = [];
    snap.forEach((d) => rows.push(d.data() as Job));
  } else {
    rows = await listJobs({ month: scope, includeArchived: true });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    filename: `hayden-tracker-${scope}.csv`,
    csv: jobsToCsv(rows),
  };
}
