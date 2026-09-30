// "audit" namespace — referenced as t("audit.<key>"). Keep en/ar keys in sync.
const en: Record<string, string> = {
  title: "Audit Logs",
  subtitle: "Who did what, when and from where — every change, approval, export, login and connection.",
  source: "Application audit log",
  exportCsv: "Export CSV",
  entries: "{n} entries",
  retentionNote: "Sensitive values (tokens, passwords, secrets) are redacted before they are stored.",
  empty: "No audit entries",
  time: "Time",
  user: "User",
  action: "Action",
  entity: "Entity",
  entityId: "Entity ID",
  summary: "Summary",
  ip: "IP",
  system: "System",
  showChanges: "Show changes",
};

const ar: Record<string, string> = {
  title: "سجل التدقيق",
  subtitle: "من فعل ماذا ومتى ومن أين — كل تعديل واعتماد وتصدير وتسجيل دخول وربط.",
  source: "سجل تدقيق التطبيق",
  exportCsv: "تصدير CSV",
  entries: "{n} سجل",
  retentionNote: "القيم الحساسة (المفاتيح وكلمات المرور والأسرار) تُحجب قبل التخزين.",
  empty: "لا توجد سجلات تدقيق",
  time: "الوقت",
  user: "المستخدم",
  action: "الإجراء",
  entity: "الكيان",
  entityId: "معرّف الكيان",
  summary: "الملخص",
  ip: "IP",
  system: "النظام",
  showChanges: "عرض التغييرات",
};

const messages = { en, ar };
export default messages;
