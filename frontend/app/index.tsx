import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

// --- Domain constants ---------------------------------------------------------
const USER_ANDREWS = "Hayden Andrews";
const USER_BONE = "Hayden Bone";

const SERVICES = [
  "Picture Framing",
  "Large Format Printing",
  "Large Format Scanning",
] as const;
type Service = (typeof SERVICES)[number];

const SERVICE_OWNER: Record<Service, string> = {
  "Picture Framing": USER_ANDREWS,
  "Large Format Printing": USER_ANDREWS,
  "Large Format Scanning": USER_BONE,
};

const ANDREWS_AVATAR =
  "https://static.prod-images.emergentagent.com/jobs/317cf10a-b416-48a2-8c58-ccdbed510f7f/images/a2bcbc00b0d5c89e45ade35ab40108481381c24b7cd6e8d1e7c911d5b5db29cd.png";
const BONE_AVATAR =
  "https://static.prod-images.emergentagent.com/jobs/317cf10a-b416-48a2-8c58-ccdbed510f7f/images/8e57f4f50afbf726c3b43247561b41044e48353e9a47117b86e680549a96e74c.png";

// --- Theme --------------------------------------------------------------------
const C = {
  bg: "#F7F7F7",
  surface: "#FFFFFF",
  inverse: "#111111",
  textPrimary: "#111111",
  textSecondary: "#5E5E5E",
  textMuted: "#A1A1AA",
  border: "#E5E5E5",
  andrews: "#E52B12",
  andrewsSoft: "#FEE2E2",
  bone: "#002FA7",
  boneSoft: "#DBEAFE",
  discount: "#10B981",
};

// --- Types --------------------------------------------------------------------
type Job = {
  id: string;
  user: string;
  service: Service;
  base_price: number;
  discount_percent: number;
  final_cost: number;
  notes: string;
  date: string;
  month: string;
  archived: boolean;
};

type Summary = {
  month: string;
  total_andrews: number;
  total_bone: number;
  net_balance: number;
  debtor: string | null;
  creditor: string | null;
  job_count: number;
};

// --- Helpers ------------------------------------------------------------------
const fmtMoney = (n: number) =>
  `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const fmtMonthLabel = (m: string) => {
  if (!m) return "";
  const [y, mm] = m.split("-");
  const d = new Date(Number(y), Number(mm) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const colorForUser = (u: string) => (u === USER_ANDREWS ? C.andrews : C.bone);
const softForUser = (u: string) =>
  u === USER_ANDREWS ? C.andrewsSoft : C.boneSoft;
const avatarForUser = (u: string) =>
  u === USER_ANDREWS ? ANDREWS_AVATAR : BONE_AVATAR;
const shortUser = (u: string) => (u === USER_ANDREWS ? "ANDREWS" : "BONE");

// --- Component ----------------------------------------------------------------
export default function Index() {
  const [actingAs, setActingAs] = useState<string>(USER_ANDREWS);
  const [service, setService] = useState<Service>("Picture Framing");
  const [basePrice, setBasePrice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [months, setMonths] = useState<string[]>([currentMonthKey()]);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);

  const isCurrentMonth = selectedMonth === currentMonthKey();

  // --- Discount preview based on current selection
  const previewDiscount = useMemo(() => {
    return SERVICE_OWNER[service] === actingAs ? 0 : 20;
  }, [actingAs, service]);

  const previewFinal = useMemo(() => {
    const n = parseFloat(basePrice);
    if (Number.isNaN(n) || n <= 0) return null;
    return n * (1 - previewDiscount / 100);
  }, [basePrice, previewDiscount]);

  // --- Data fetching
  const loadAll = useCallback(async (month: string) => {
    try {
      const [jobsRes, sumRes, monthsRes] = await Promise.all([
        fetch(`${API_BASE}/jobs?month=${month}`),
        fetch(`${API_BASE}/summary?month=${month}`),
        fetch(`${API_BASE}/months`),
      ]);
      const jobsData = await jobsRes.json();
      const sumData = await sumRes.json();
      const monthsData = await monthsRes.json();
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      setSummary(sumData);
      setMonths(monthsData.months ?? [currentMonthKey()]);
    } catch (e) {
      console.warn("loadAll error", e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll(selectedMonth);
      setLoading(false);
    })();
  }, [selectedMonth, loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(selectedMonth);
    setRefreshing(false);
  }, [loadAll, selectedMonth]);

  // --- Actions
  const submitJob = async () => {
    const n = parseFloat(basePrice);
    if (Number.isNaN(n) || n <= 0) {
      Alert.alert("Invalid price", "Please enter a base production price greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: actingAs,
          service,
          base_price: n,
          notes,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      setBasePrice("");
      setNotes("");
      // Switch view to current month so the new job is visible
      if (!isCurrentMonth) {
        setSelectedMonth(currentMonthKey());
      } else {
        await loadAll(selectedMonth);
      }
    } catch (e: any) {
      Alert.alert("Could not log job", String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteJob = (id: string) => {
    Alert.alert("Delete job?", "This will remove the job from the ledger.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await fetch(`${API_BASE}/jobs/${id}`, { method: "DELETE" });
            await loadAll(selectedMonth);
          } catch (e) {
            console.warn(e);
          }
        },
      },
    ]);
  };

  const exportCsv = async (scope: string) => {
    // scope is "all" or a YYYY-MM string
    const url = `${API_BASE}/jobs/export?month=${encodeURIComponent(scope)}`;
    try {
      if (Platform.OS === "web") {
        // Trigger a download in a new tab — Content-Disposition handles the rest
        // eslint-disable-next-line no-undef
        window.open(url, "_blank");
      } else {
        const can = await Linking.canOpenURL(url);
        if (can) {
          await Linking.openURL(url);
        } else {
          Alert.alert("Cannot open URL", "Unable to start the CSV download.");
        }
      }
    } catch (e: any) {
      Alert.alert("Export failed", String(e?.message ?? e));
    } finally {
      setExportPickerOpen(false);
    }
  };

  const archiveMonth = () => {
    Alert.alert(
      "Archive current month?",
      "This clears the active ledger for the current month. Jobs are kept in history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(
                `${API_BASE}/jobs/archive?month=${currentMonthKey()}`,
                { method: "POST" },
              );
              await loadAll(selectedMonth);
            } catch (e) {
              console.warn(e);
            }
          },
        },
      ],
    );
  };

  // --- Render ----------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.inverse} />
          }
        >
          {/* Header */}
          <View style={styles.header} testID="app-header">
            <Text style={styles.kicker}>SHARED-SERVICE TRACKER</Text>
            <Text style={styles.title}>The Hayden{"\n"}Workspace Ledger</Text>
          </View>

          {/* Acting As toggle */}
          <View style={styles.section}>
            <Text style={styles.label}>ACTING AS</Text>
            <View style={styles.toggleRow} testID="acting-as-toggle">
              {[USER_ANDREWS, USER_BONE].map((u) => {
                const active = actingAs === u;
                return (
                  <TouchableOpacity
                    key={u}
                    testID={`acting-as-${u === USER_ANDREWS ? "andrews" : "bone"}`}
                    onPress={() => setActingAs(u)}
                    activeOpacity={0.85}
                    style={[
                      styles.toggleBtn,
                      active && { backgroundColor: colorForUser(u), borderColor: colorForUser(u) },
                    ]}
                  >
                    <Image source={{ uri: avatarForUser(u) }} style={styles.toggleAvatar} />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.toggleName,
                          active && { color: "#FFFFFF" },
                        ]}
                      >
                        {u}
                      </Text>
                      <Text
                        style={[
                          styles.toggleSub,
                          active && { color: "rgba(255,255,255,0.85)" },
                        ]}
                      >
                        {u === USER_ANDREWS ? "Frames · Prints" : "Scans"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Quick Log Form */}
          <View style={styles.card} testID="log-job-card">
            <Text style={styles.h2}>Log a job</Text>
            <Text style={styles.cardSub}>
              Discount auto-applies when {actingAs.split(" ")[1]} uses the other Hayden&apos;s service.
            </Text>

            <Text style={[styles.label, { marginTop: 18 }]}>SERVICE</Text>
            <TouchableOpacity
              testID="service-picker"
              style={styles.input}
              onPress={() => setServicePickerOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.inputText}>{service}</Text>
              <Ionicons name="chevron-down" size={18} color={C.textSecondary} />
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 14 }]}>BASE PRODUCTION PRICE</Text>
            <View style={styles.input}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                testID="base-price-input"
                value={basePrice}
                onChangeText={(t) => setBasePrice(t.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                style={styles.priceInput}
                returnKeyType="done"
              />
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>JOB NAME</Text>
            <View style={styles.input}>
              <TextInput
                testID="job-name-input"
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Studio A — 3 x A1 prints"
                placeholderTextColor={C.textMuted}
                style={styles.textInputFlex}
                returnKeyType="done"
              />
            </View>

            {/* Preview row */}
            <View style={styles.previewRow} testID="discount-preview">
              <View style={styles.previewCell}>
                <Text style={styles.previewLabel}>DISCOUNT</Text>
                <Text
                  style={[
                    styles.previewVal,
                    { color: previewDiscount > 0 ? C.discount : C.textMuted },
                  ]}
                >
                  {previewDiscount}%
                </Text>
              </View>
              <View style={styles.previewDivider} />
              <View style={styles.previewCell}>
                <Text style={styles.previewLabel}>FINAL COST</Text>
                <Text style={styles.previewVal}>
                  {previewFinal == null ? "—" : fmtMoney(previewFinal)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              testID="log-job-submit"
              style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
              onPress={submitJob}
              disabled={submitting}
              activeOpacity={0.9}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>LOG JOB</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Monthly Tally Card */}
          <MonthlyTallyCard
            summary={summary}
            month={selectedMonth}
            months={months}
            onOpenMonths={() => setMonthPickerOpen(true)}
          />

          {/* Ledger */}
          <View style={styles.section}>
            <View style={styles.ledgerHead}>
              <Text style={styles.h2}>Jobs ledger</Text>
              <Text style={styles.cardSub}>
                {jobs.length} job{jobs.length === 1 ? "" : "s"} · {fmtMonthLabel(selectedMonth)}
              </Text>
            </View>

            <View style={styles.ledger} testID="jobs-ledger">
              {loading ? (
                <View style={styles.empty}>
                  <ActivityIndicator color={C.inverse} />
                </View>
              ) : jobs.length === 0 ? (
                <View style={styles.empty} testID="ledger-empty">
                  <Text style={styles.emptyTitle}>No jobs logged</Text>
                  <Text style={styles.emptySub}>
                    Log your first job above to see it appear here.
                  </Text>
                </View>
              ) : (
                jobs.map((j) => (
                  <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
                ))
              )}
            </View>

            {isCurrentMonth && jobs.length > 0 && (
              <TouchableOpacity
                testID="archive-month-btn"
                style={styles.archiveBtn}
                onPress={archiveMonth}
                activeOpacity={0.9}
              >
                <Ionicons name="archive-outline" size={16} color={C.textPrimary} />
                <Text style={styles.archiveBtnText}>ARCHIVE CURRENT MONTH</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.footer}>
            Ownership rules · Andrews owns Framing & Printing · Bone owns Scanning · 20% wholesale across the fence
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Service picker modal */}
      <PickerModal
        visible={servicePickerOpen}
        title="Select service"
        options={SERVICES.map((s) => ({
          value: s,
          label: s,
          sub: `Owner: ${SERVICE_OWNER[s].split(" ")[1]}`,
        }))}
        selected={service}
        onSelect={(v) => {
          setService(v as Service);
          setServicePickerOpen(false);
        }}
        onClose={() => setServicePickerOpen(false)}
      />

      {/* Month picker modal */}
      <PickerModal
        visible={monthPickerOpen}
        title="Select month"
        options={months.map((m) => ({
          value: m,
          label: fmtMonthLabel(m),
          sub: m === currentMonthKey() ? "Current month" : undefined,
        }))}
        selected={selectedMonth}
        onSelect={(v) => {
          setSelectedMonth(v);
          setMonthPickerOpen(false);
        }}
        onClose={() => setMonthPickerOpen(false)}
      />
      {/* Export CSV picker modal */}
      <PickerModal
        visible={exportPickerOpen}
        title="Download CSV"
        options={[
          { value: "all", label: "All jobs", sub: "Every job ever logged" },
          ...months.map((m) => ({
            value: m,
            label: fmtMonthLabel(m),
            sub: m === currentMonthKey() ? "Current month" : "Calendar month",
          })),
        ]}
        selected=""
        onSelect={(v) => exportCsv(v)}
        onClose={() => setExportPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

// --- Sub components ----------------------------------------------------------

function JobRow({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const userColor = colorForUser(job.user);
  return (
    <View style={styles.jobRow} testID={`job-row-${job.id}`}>
      <View style={[styles.jobAccent, { backgroundColor: userColor }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.jobTopRow}>
          <Text style={styles.jobService} numberOfLines={1}>
            {job.service}
          </Text>
          <Text style={styles.jobFinal}>{fmtMoney(job.final_cost)}</Text>
        </View>

        <View style={styles.jobMetaRow}>
          <View
            style={[styles.userBadge, { backgroundColor: softForUser(job.user) }]}
          >
            <View style={[styles.userDot, { backgroundColor: userColor }]} />
            <Text style={[styles.userBadgeText, { color: userColor }]}>
              {shortUser(job.user)}
            </Text>
          </View>
          <Text style={styles.jobDate}>{fmtDate(job.date)}</Text>
          {job.discount_percent > 0 ? (
            <Text style={styles.discountText}>−{job.discount_percent}%</Text>
          ) : (
            <Text style={styles.basePriceText}>Base {fmtMoney(job.base_price)}</Text>
          )}
        </View>

        {job.notes ? <Text style={styles.jobNotes} numberOfLines={2}>{job.notes}</Text> : null}
      </View>

      <TouchableOpacity
        testID={`delete-job-${job.id}`}
        onPress={onDelete}
        style={styles.deleteBtn}
        hitSlop={8}
      >
        <Ionicons name="trash-outline" size={18} color={C.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function MonthlyTallyCard({
  summary,
  month,
  months,
  onOpenMonths,
}: {
  summary: Summary | null;
  month: string;
  months: string[];
  onOpenMonths: () => void;
}) {
  const debtor = summary?.debtor;
  const creditor = summary?.creditor;
  const accent = debtor === USER_ANDREWS ? C.andrews : debtor === USER_BONE ? C.bone : "#FFFFFF";

  return (
    <View style={[styles.tallyCard, { borderLeftColor: accent }]} testID="monthly-tally">
      <View style={styles.tallyTopRow}>
        <Text style={styles.tallyKicker}>NET BALANCE</Text>
        <TouchableOpacity
          testID="month-picker"
          onPress={onOpenMonths}
          style={styles.monthPickerBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="calendar-outline" size={14} color="#fff" />
          <Text style={styles.monthPickerText}>{fmtMonthLabel(month)}</Text>
          {months.length > 1 ? (
            <Ionicons name="chevron-down" size={14} color="#fff" />
          ) : null}
        </TouchableOpacity>
      </View>

      {summary == null ? (
        <ActivityIndicator color="#fff" style={{ marginVertical: 18 }} />
      ) : summary.net_balance === 0 ? (
        <>
          <Text style={styles.tallyAmount} testID="tally-amount">$0.00</Text>
          <Text style={styles.tallySub}>All square — no one owes anyone this month.</Text>
        </>
      ) : (
        <>
          <Text style={styles.tallyAmount} testID="tally-amount">
            {fmtMoney(summary.net_balance)}
          </Text>
          <Text style={styles.tallySub} testID="tally-sub">
            <Text style={{ color: "#fff", fontWeight: "700" }}>{debtor}</Text>
            <Text> owes </Text>
            <Text style={{ color: "#fff", fontWeight: "700" }}>{creditor}</Text>
          </Text>
        </>
      )}

      <View style={styles.tallyTotalsRow}>
        <View style={styles.tallyTotalCell}>
          <View style={[styles.userDot, { backgroundColor: C.andrews }]} />
          <View>
            <Text style={styles.tallyTotalLabel}>ANDREWS SPENT</Text>
            <Text style={styles.tallyTotalVal}>
              {summary ? fmtMoney(summary.total_andrews) : "—"}
            </Text>
          </View>
        </View>
        <View style={styles.tallyVDivider} />
        <View style={styles.tallyTotalCell}>
          <View style={[styles.userDot, { backgroundColor: C.bone }]} />
          <View>
            <Text style={styles.tallyTotalLabel}>BONE SPENT</Text>
            <Text style={styles.tallyTotalVal}>
              {summary ? fmtMoney(summary.total_bone) : "—"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function PickerModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { value: string; label: string; sub?: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} testID="picker-close">
              <Ionicons name="close" size={22} color={C.textPrimary} />
            </TouchableOpacity>
          </View>
          {options.map((o) => {
            const active = o.value === selected;
            return (
              <TouchableOpacity
                key={o.value}
                testID={`picker-option-${o.value}`}
                style={styles.modalOption}
                onPress={() => onSelect(o.value)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalOptionLabel}>{o.label}</Text>
                  {o.sub ? <Text style={styles.modalOptionSub}>{o.sub}</Text> : null}
                </View>
                {active ? (
                  <Ionicons name="checkmark" size={20} color={C.inverse} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// --- Styles -------------------------------------------------------------------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48, gap: 18 },

  header: { paddingTop: 12, paddingBottom: 4 },
  kicker: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    color: C.textSecondary,
    marginBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "900",
    color: C.textPrimary,
    lineHeight: 36,
    letterSpacing: -1,
  },

  section: { gap: 10 },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: C.textSecondary,
  },
  h2: { fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },

  // toggle
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleAvatar: { width: 36, height: 36, borderRadius: 4, backgroundColor: "#eee" },
  toggleName: { fontSize: 14, fontWeight: "800", color: C.textPrimary },
  toggleSub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },

  // card
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    gap: 6,
  },
  cardSub: { color: C.textSecondary, fontSize: 13, lineHeight: 18 },

  input: {
    height: 50,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  inputText: { color: C.textPrimary, fontSize: 15, fontWeight: "600", flex: 1 },
  dollar: { fontSize: 16, color: C.textSecondary, marginRight: 6, fontWeight: "600" },
  priceInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
    paddingVertical: 0,
  },
  textInputFlex: {
    flex: 1,
    fontSize: 15,
    color: C.textPrimary,
    paddingVertical: 0,
  },

  previewRow: {
    flexDirection: "row",
    backgroundColor: "#FAFAFA",
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 14,
  },
  previewCell: { flex: 1, padding: 14, gap: 4 },
  previewDivider: { width: 1, backgroundColor: C.border },
  previewLabel: { fontSize: 10, letterSpacing: 1.2, color: C.textSecondary, fontWeight: "800" },
  previewVal: { fontSize: 20, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.5 },

  primaryBtn: {
    height: 52,
    backgroundColor: C.inverse,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 2,
  },

  // tally
  tallyCard: {
    backgroundColor: C.inverse,
    padding: 22,
    borderLeftWidth: 6,
    borderLeftColor: "#fff",
    gap: 8,
  },
  tallyTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tallyKicker: { color: "#A1A1AA", fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  monthPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  monthPickerText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tallyAmount: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: -1.5,
    marginTop: 4,
  },
  tallySub: { color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 2 },

  tallyTotalsRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    alignItems: "center",
  },
  tallyTotalCell: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  tallyVDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.1)" },
  tallyTotalLabel: { color: "#A1A1AA", fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  tallyTotalVal: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 2 },

  // ledger
  ledgerHead: { gap: 4 },
  ledger: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  empty: { padding: 32, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: "center" },

  jobRow: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
    alignItems: "flex-start",
  },
  jobAccent: { width: 4, alignSelf: "stretch", marginTop: 2 },
  jobTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  jobService: { fontSize: 15, fontWeight: "800", color: C.textPrimary, flex: 1 },
  jobFinal: { fontSize: 16, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  jobMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    flexWrap: "wrap",
  },
  userBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  userDot: { width: 8, height: 8, borderRadius: 4 },
  userBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  jobDate: { fontSize: 12, color: C.textSecondary },
  discountText: { fontSize: 12, fontWeight: "800", color: C.discount },
  basePriceText: { fontSize: 12, color: C.textMuted },
  jobNotes: { fontSize: 13, color: C.textSecondary, marginTop: 6, fontStyle: "italic" },
  deleteBtn: {
    padding: 6,
    marginTop: 2,
  },

  archiveBtn: {
    marginTop: 12,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  secondaryBtn: {
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 8,
  },
  archiveBtnText: { color: C.textPrimary, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },

  footer: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 16,
  },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: C.surface,
    padding: 20,
    paddingBottom: 32,
    gap: 4,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  modalOptionLabel: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  modalOptionSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
