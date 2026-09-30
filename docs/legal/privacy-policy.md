# Privacy Policy — DRAFT · سياسة الخصوصية — مسودة

> ⚠️ **PLACEHOLDER — REQUIRES LEGAL REVIEW BEFORE PUBLICATION.**
> This template was prepared by the engineering team to describe how the software processes data. It is **not legal advice**. A qualified lawyer must adapt it to the operating company, the jurisdictions served (e.g. Egypt Personal Data Protection Law No. 151/2020, UAE Federal Decree-Law No. 45/2021, KSA PDPL, EU GDPR if applicable) and the platform developer policies (Meta, Google API Services User Data Policy incl. Limited Use, TikTok, LinkedIn, X). Replace every `[[…]]`.
>
> ⚠️ **نموذج مبدئي — يجب مراجعته قانونيًا قبل النشر.** أعدّه الفريق التقني لوصف كيفية معالجة البرنامج للبيانات، وليس استشارة قانونية.

**Last updated:** [[date]] · **Controller:** [[Agency legal name, address, registration no.]] · **Contact:** [[privacy@example.com]]

## 1. Who we are and scope

[[Agency]] operates the Marketing Intelligence Dashboard ("the Service") at [[APP_URL]] for its business clients. This policy covers personal data processed through the Service. For client marketing data, [[Agency]] generally acts as a **processor** on behalf of the client (controller) under the service agreement; for its own users and staff it acts as **controller**. [[Confirm roles with counsel.]]

## 2. Data we process

| Category | Examples | Source |
|---|---|---|
| Account data | Name, business e-mail, role, language, hashed password, 2FA status | You / your administrator |
| Security & usage logs | Login times, IP address, browser user-agent, audit trail of actions | Automatically |
| Client business data | Company profile, contacts (name, e-mail, phone), plans, budgets, content, comments, approvals, files you upload | You / the agency |
| Advertising & analytics data | Aggregated campaign, page and website metrics (spend, impressions, clicks, leads…) — **no end-user personal data** | Platforms you connect via their official APIs (Meta, Google, TikTok, LinkedIn, X) |
| Platform credentials | OAuth access/refresh tokens (encrypted) | Platforms, with your authorization |
| Competitor information | Publicly available ads from official ad libraries, public profile figures | Meta Ad Library API, manual research |

We do not use cookies for advertising or third-party analytics. We use one essential session cookie (`mimd_session`), a language/theme preference cookie, and a short-lived security cookie during platform connection.

## 3. Purposes and legal bases

* Provide the Service (contract).
* Security, fraud prevention, audit logs (legitimate interests / legal obligation).
* Sending reports, alerts and account e-mails (contract).
* Optional AI-assisted analysis when a user invokes it (contract / legitimate interest) — see §5.
* [[Add/confirm bases per jurisdiction.]]

## 4. Platform data (Google, Meta, TikTok, LinkedIn, X)

* Accessed only with read-only permissions you grant, used only to display reporting inside the Service for the connected client.
* Not sold, not used for advertising, not transferred except as needed to provide the Service or required by law.
* **Google:** The Service's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.
* You can revoke access at any time in the Service (Disconnect) and in the platform's security settings.

## 5. AI processing

If enabled by your agency, aggregated, client-scoped data may be sent to Anthropic's Claude API to generate suggestions when a user requests it. Suggestions are never applied automatically. [[Confirm provider terms: no training on API data, retention period, data location.]]

## 6. Sharing and sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| [[Hostinger International Ltd.]] | Hosting (servers, database) | [[region]] |
| [[E-mail provider]] | Transactional e-mail | [[region]] |
| [[Backup storage provider]] | Encrypted off-site backups | [[region]] |
| Anthropic PBC (optional) | AI suggestions | [[region]] |
| Sentry (optional) | Error monitoring | [[region]] |

Shared report links are accessible to anyone who has the link until it expires or is revoked.

## 7. International transfers

[[Describe transfer mechanisms (e.g. SCCs) where data leaves the client's jurisdiction.]]

## 8. Retention

* Account data: while the account is active + [[N]] months.
* Audit logs: [[12]] months minimum.
* Client data: for the contract term; deleted or returned within [[N]] days after termination.
* Backups: rolling [[14 daily / 8 weekly]] on server and [[90]] days off-site, then overwritten.

## 9. Security

HTTPS/HSTS, encrypted platform tokens (AES-256-GCM), hashed passwords (bcrypt), optional two-factor authentication, role-based access and client isolation, audit logging, daily encrypted backups. See the Service's security documentation.

## 10. Your rights

Depending on your jurisdiction: access, rectification, erasure, restriction, objection, portability, withdrawal of consent, complaint to a supervisory authority ([[authority name]]). Contact [[privacy@example.com]]. Client end-users should contact the client (controller) first.

## 11. Children

The Service is for business users and is not directed at children under [[16/18]].

## 12. Changes

We will notify administrators of material changes [[N]] days in advance.

---

<div dir="rtl">

## ملخص بالعربية (مسودة — للمراجعة القانونية)

* **من نحن:** [[اسم الوكالة]] تشغّل منصة ذكاء وإدارة التسويق لعملائها من الشركات.
* **البيانات:** بيانات الحساب (الاسم، البريد، الدور)، سجلات الأمان (أوقات الدخول، عنوان IP)، بيانات العميل التجارية (الخطط، المحتوى، الملفات)، ومؤشرات إعلانية مجمّعة من المنصات التي تربطها **دون بيانات شخصية للجمهور**، ورموز الربط مشفّرة.
* **الاستخدام:** تقديم الخدمة والتقارير والتنبيهات والأمان؛ والتحليل بالذكاء الاصطناعي اختياريًا وعند الطلب فقط دون تطبيق تلقائي.
* **المشاركة:** مع مزودي الخدمة المذكورين فقط (الاستضافة، البريد، النسخ الاحتياطي، والذكاء الاصطناعي/مراقبة الأخطاء اختياريًا). لا نبيع البيانات.
* **بيانات Google وغيرها:** تُستخدم وفق سياسات المنصات بما فيها متطلبات "الاستخدام المحدود" من Google، ويمكنك إلغاء الربط في أي وقت.
* **الاحتفاظ:** طوال مدة العقد ثم الحذف خلال [[N]] يومًا؛ النسخ الاحتياطية تُستبدل خلال [[المدة]].
* **حقوقك:** الاطلاع والتصحيح والحذف والاعتراض ونقل البيانات وتقديم شكوى — تواصل عبر [[البريد]].

</div>
