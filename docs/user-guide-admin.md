# Administrator Guide · دليل مدير النظام

For **Super Admins** and **Company Managers**. · لـ **مدير النظام** و**مدير الشركة**.

[English](#english) · [العربية](#arabic)

---

<a id="english"></a>

## English

### 1. Your role

| Role | You can | You cannot |
|---|---|---|
| Super Admin | Everything: users, roles, permissions, integrations and tokens, system settings, audit logs, all clients. | — |
| Company Manager | Everything for all clients (clients, strategy, budget and content approvals, reports, share links, benchmarks, audit logs, team performance), view users and settings. | Invite/manage users (unless a Super Admin grants `users:manage`), connect integrations, change system settings. |

### 2. First login and securing your account

1. Open the address you received (e.g. `https://dashboard.example.com`) and sign in with your e-mail and password.
2. If you are using the demo workspace (`admin@demo.local` / `Demo@12345`), **change the password immediately** from the user menu → Profile — or better, create your own admin and deactivate demo users.
3. User menu → **Two-factor authentication** → scan the QR code with Google Authenticator / Microsoft Authenticator / 1Password → enter the 6-digit code. 2FA is strongly recommended for every admin.
4. Choose your language (العربية / English) and theme (light/dark) from the header.

### 3. Organization settings (`Settings`)

* **General:** organization name, default currency (e.g. EGP), time zone (e.g. Africa/Cairo), default language.
* **Branding:** logo and primary colour — used across the app and in reports.
* **FX rates:** exchange rates used when combining clients/accounts in different currencies. Update them monthly; the source and date are shown next to converted totals.
* **Security:** require 2FA for admins, session policy.
* **Notifications:** default alert thresholds (e.g. spend variance > 15 %).

Only Super Admins can change settings; Company Managers can view them.

### 4. Clients (`Clients`)

1. **Clients → New client** (or follow the Onboarding wizard): name, industry, country, currency, time zone, website, products, audiences, branches, goals, contract/package, account manager.
2. Add **brands** if the client has several, and link **ad accounts / pages** (after connecting integrations).
3. **White label:** brand colours, fonts, report theme, and **hidden sections** — sections that the client's own users will not see (e.g. hide *Audit* or *Competitors*).
4. **Access:** choose which team members and client users can see this client.
5. Archive a client to hide it everywhere without deleting data; delete only when the contract requires erasure (irreversible).

### 5. Users & permissions (`Users & Permissions`)

1. **Invite user:** e-mail, role, and the clients they can access. The person receives a link valid for a limited time, sets a name and password and lands on onboarding.
2. **Roles** (defaults):
   * *Marketing Team* — plans, content, budgets (edit, not approve), reports, AI.
   * *Client* — sees only their clients; approves content at the client stage; comments; exports reports.
   * *Viewer* — read-only.
3. **Client access rules:** Marketing Team members with no clients assigned see **all** clients; Client and Viewer users see **only** assigned clients.
4. **Fine-tune permissions:** add or remove individual permissions for a user (e.g. give a senior buyer *Approve budget*, remove *Delete content* from a junior). Some permissions can never be given to non-Super-Admins (managing integrations and system settings), and clients can never see internal comments or audit logs.
5. **Deactivate** users who leave — their sessions end immediately; their history stays in the audit log. Reset 2FA only after verifying identity.

### 6. Integrations (`Settings → Integrations`) — Super Admin only

1. Make sure the server has the platform keys (your developer sets them — see `docs/integrations-setup.md`). Each card shows which settings are missing.
2. Choose the client, then **Connect** on the platform card and approve access in the platform's window (read-only permissions).
3. After returning, select which ad accounts/pages belong to this client. The first sync pulls about 90 days.
4. Read the status:
   * **Connected** (green) — working. **Syncing** (blue) — in progress.
   * **Permission missing** (orange) — some permission was not granted → **Reconnect** and tick all boxes.
   * **Expired** (red) — token revoked or expired → **Reconnect**.
   * **Sync failed** (red) — see the last error; it retries automatically.
5. Tokens are encrypted; you only ever see the last 4 characters (`****1234`).
6. **Sync now**, **Test**, **Disconnect** are on each card. Every action is recorded in the audit log.
7. X requires a paid API tier; Google Trends has no official API (use Trends → Import).

### 7. Approvals and governance

* **Strategy:** review sections and click **Approve** (creates a new approved version).
* **Budget:** review plan totals and expected results, then **Approve**. Approved plans are the baseline for Plan vs Actual.
* **Content:** Approval Center → *Internal review* queue → Approve / Request changes / Reject. Approved items move to the client review stage.
* **AI suggestions** are never applied automatically — accept or reject each one.

### 8. Reports and sharing

* Build reports in **Reports** (monthly client, executive, campaign, content, competitor, budget…), schedule e-mail delivery, add recipients.
* **Share link** creates a read-only public link with an expiry date. Revoke it any time. Only people with the *share* permission can create links.

### 9. Monitoring

* **Notifications:** spend over/under plan, CPL up, ROAS down, high frequency, budget ending, sync stopped, token expiring, content due/rejected, new competitor ads.
* **Audit logs:** filter by user, action, client and date; export to Excel for compliance.
* **Data badges:** *Demo Data* (purple) means sample data; *Estimate* means a calculated value (forecast, FX, competitor intensity) — explain this to clients.

### 10. Good practice checklist

- [ ] 2FA on for all admins and managers.
- [ ] Each client has an account manager and correct currency/time zone.
- [ ] Remove access when staff leave; review user list monthly.
- [ ] Check the integrations page weekly for red/orange cards.
- [ ] Confirm backups and the monthly restore drill with your technical team.
- [ ] Never use demo accounts in production.

---

<a id="arabic"></a>

<div dir="rtl">

## العربية

### 1. دورك

| الدور | يمكنك | لا يمكنك |
|---|---|---|
| مدير النظام | كل شيء: المستخدمون والأدوار والصلاحيات، ربط المنصات ورموزها، إعدادات النظام، سجل التدقيق، جميع العملاء. | — |
| مدير الشركة | كل ما يخص جميع العملاء (العملاء، الاستراتيجية، اعتماد الميزانيات والمحتوى، التقارير وروابط المشاركة، المعايير، سجل التدقيق، أداء الفريق)، وعرض المستخدمين والإعدادات. | دعوة المستخدمين وإدارتهم (إلا إذا منحه مدير النظام صلاحية `users:manage`)، ربط المنصات، تعديل إعدادات النظام. |

### 2. أول دخول وتأمين حسابك

1. افتح الرابط الذي استلمته (مثل `https://dashboard.example.com`) وسجّل الدخول ببريدك وكلمة المرور.
2. إذا كنت تستخدم مساحة العرض التجريبية (`admin@demo.local` / `Demo@12345`) **غيّر كلمة المرور فورًا** من قائمة المستخدم ← الملف الشخصي، والأفضل إنشاء حساب مدير خاص بك وتعطيل الحسابات التجريبية.
3. قائمة المستخدم ← **المصادقة الثنائية** ← امسح رمز QR بتطبيق Google Authenticator أو Microsoft Authenticator ← أدخل الرمز المكوّن من 6 أرقام. ننصح بشدة بتفعيلها لكل المديرين.
4. اختر اللغة (العربية / English) والمظهر (فاتح/داكن) من أعلى الصفحة.

### 3. إعدادات المؤسسة (`الإعدادات`)

* **عام:** اسم المؤسسة، العملة الافتراضية (مثل الجنيه المصري)، المنطقة الزمنية (مثل القاهرة)، اللغة الافتراضية.
* **الهوية:** الشعار واللون الأساسي — يظهران في المنصة وفي التقارير.
* **أسعار الصرف:** تُستخدم عند جمع عملاء أو حسابات بعملات مختلفة. حدّثها شهريًا؛ يظهر المصدر والتاريخ بجانب الإجماليات المحوّلة.
* **الأمان:** إلزام المديرين بالمصادقة الثنائية، سياسة الجلسات.
* **التنبيهات:** الحدود الافتراضية (مثل انحراف الإنفاق أكثر من 15٪).

مدير النظام فقط يعدّل الإعدادات؛ مدير الشركة يطّلع عليها.

### 4. العملاء (`العملاء`)

1. **العملاء ← عميل جديد** (أو اتبع معالج الإعداد): الاسم، المجال، الدولة، العملة، المنطقة الزمنية، الموقع، المنتجات، الجمهور، الفروع، الأهداف، العقد/الباقة، مدير الحساب.
2. أضف **العلامات التجارية** إن وُجدت أكثر من علامة، واربط **الحسابات الإعلانية والصفحات** (بعد ربط المنصات).
3. **العلامة البيضاء (White label):** ألوان العميل، الخطوط، شكل التقارير، و**الأقسام المخفية** — أقسام لن يراها مستخدمو العميل (مثل إخفاء سجل التدقيق أو المنافسين).
4. **الوصول:** حدّد أعضاء الفريق ومستخدمي العميل الذين يرون هذا العميل.
5. **الأرشفة** تخفي العميل من كل مكان دون حذف بياناته؛ استخدم **الحذف** فقط إذا تطلّب العقد مسح البيانات (لا يمكن التراجع).

### 5. المستخدمون والصلاحيات (`المستخدمون والصلاحيات`)

1. **دعوة مستخدم:** البريد، الدور، والعملاء المسموح له بهم. يصله رابط صالح لفترة محددة، فيحدد اسمه وكلمة مروره ثم ينتقل إلى الإعداد الأولي.
2. **الأدوار** (افتراضيًا):
   * *فريق التسويق* — الخطط، المحتوى، الميزانيات (تعديل دون اعتماد)، التقارير، الذكاء الاصطناعي.
   * *العميل* — يرى عملاءه فقط، يعتمد المحتوى في مرحلة العميل، يعلّق، يصدّر التقارير.
   * *المشاهد* — قراءة فقط.
3. **قواعد الوصول للعملاء:** عضو فريق التسويق الذي لم يُخصَّص له أي عميل يرى **كل** العملاء؛ مستخدم العميل والمشاهد يريان **فقط** العملاء المخصّصين لهما.
4. **ضبط الصلاحيات بدقة:** أضف أو اسحب صلاحية معينة لمستخدم (مثل منح مشتري إعلانات خبير صلاحية *اعتماد الميزانية*، أو سحب *حذف المحتوى* من موظف مبتدئ). بعض الصلاحيات لا تُمنح أبدًا لغير مدير النظام (إدارة التكاملات وإعدادات النظام)، والعميل لا يرى أبدًا التعليقات الداخلية ولا سجل التدقيق.
5. **عطّل** حساب من يغادر — تنتهي جلساته فورًا ويبقى سجله في التدقيق. لا تُعِد ضبط المصادقة الثنائية إلا بعد التحقق من هوية الشخص.

### 6. التكاملات (`الإعدادات ← التكاملات`) — لمدير النظام فقط

1. تأكد أن مفاتيح المنصة مضبوطة على الخادم (يضبطها المطوّر — راجع `docs/integrations-setup.md`). كل بطاقة توضّح الإعدادات الناقصة.
2. اختر العميل ثم اضغط **ربط** على بطاقة المنصة ووافق على الوصول في نافذة المنصة (صلاحيات قراءة فقط).
3. بعد العودة، اختر الحسابات الإعلانية/الصفحات التابعة لهذا العميل. أول مزامنة تجلب نحو 90 يومًا.
4. اقرأ الحالة:
   * **متصل** (أخضر) — يعمل. **جارٍ المزامنة** (أزرق).
   * **صلاحيات ناقصة** (برتقالي) — لم تُمنح بعض الصلاحيات ← **أعد الربط** وحدّد كل الخيارات.
   * **منتهي الصلاحية** (أحمر) — الرمز أُلغي أو انتهى ← **أعد الربط**.
   * **فشل المزامنة** (أحمر) — راجع آخر خطأ؛ تُعاد المحاولة تلقائيًا.
5. الرموز مشفّرة، ولا ترى منها إلا آخر 4 أحرف (`****1234`).
6. أزرار **مزامنة الآن** و**اختبار** و**فصل** على كل بطاقة، وكل إجراء يُسجَّل في سجل التدقيق.
7. منصة X تتطلب اشتراكًا مدفوعًا في واجهتها؛ Google Trends بلا واجهة رسمية (استخدم الاتجاهات ← استيراد).

### 7. الاعتمادات والحوكمة

* **الاستراتيجية:** راجع الأقسام واضغط **اعتماد** (يُنشئ نسخة معتمدة جديدة).
* **الميزانية:** راجع الإجمالي والنتائج المتوقعة ثم **اعتماد**. الخطة المعتمدة هي الأساس في "المخطط مقابل الفعلي".
* **المحتوى:** مركز الموافقات ← قائمة *المراجعة الداخلية* ← اعتماد / طلب تعديلات / رفض. المعتمد داخليًا ينتقل لمراجعة العميل.
* **اقتراحات الذكاء الاصطناعي** لا تُطبَّق تلقائيًا أبدًا — اقبل أو ارفض كل اقتراح.

### 8. التقارير والمشاركة

* أنشئ التقارير من **التقارير** (شهري للعميل، تنفيذي، حملة، محتوى، منافسين، ميزانية…)، وجدول إرسالها بالبريد وأضف المستلمين.
* **رابط المشاركة** ينشئ رابطًا عامًا للقراءة فقط بتاريخ انتهاء، ويمكن إلغاؤه في أي وقت. إنشاء الروابط لمن يملك صلاحية *المشاركة* فقط.

### 9. المتابعة

* **التنبيهات:** تجاوز الإنفاق أو نقصه عن الخطة، ارتفاع تكلفة العميل المحتمل، انخفاض العائد على الإنفاق، ارتفاع التكرار، قرب نفاد الميزانية، توقف المزامنة، قرب انتهاء الرمز، محتوى مستحق أو مرفوض، إعلانات جديدة للمنافسين.
* **سجل التدقيق:** فلترة حسب المستخدم والإجراء والعميل والتاريخ، وتصدير إلى Excel للامتثال.
* **الشارات:** *بيانات تجريبية* (بنفسجي) تعني بيانات عرض؛ *تقدير* تعني قيمة محسوبة (توقع، تحويل عملة، كثافة إعلانات المنافس) — وضّح ذلك للعملاء.

### 10. قائمة الممارسات الجيدة

- [ ] المصادقة الثنائية مفعّلة لكل المديرين.
- [ ] لكل عميل مدير حساب وعملة ومنطقة زمنية صحيحة.
- [ ] سحب الوصول فور مغادرة الموظفين، ومراجعة قائمة المستخدمين شهريًا.
- [ ] مراجعة صفحة التكاملات أسبوعيًا بحثًا عن بطاقات حمراء أو برتقالية.
- [ ] التأكد مع الفريق التقني من النسخ الاحتياطي وتجربة الاسترجاع الشهرية.
- [ ] عدم استخدام الحسابات التجريبية في بيئة الإنتاج أبدًا.

</div>
