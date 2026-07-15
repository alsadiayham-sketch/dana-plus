# Dana Plus

واجهة عربية RTL لإدارة منتجات دانا، مبيعات المندوبات، الأرباح، ورسوم التوصيل. تُخزّن بيانات العمل في Firestore داخل `projects/dana-plus` وتُزامن لحظيًا بعد تسجيل دخول Dana.

## التشغيل

```powershell
Copy-Item .env.example .env.local
npm run dev
```

ضعي قيم Web App من Firebase في `.env.local`. لا تضيفي هذا الملف إلى Git.

## صور المنتجات

ImageBB هو مزود التخزين المعتمد للصور مستقبلًا. عند إضافة رفع الصور، يجب أن يتم الرفع من خدمة خادمية آمنة فقط؛ لا تضيفي مفتاح ImageBB إلى متغيرات `VITE_` أو إلى المتصفح.

## كتالوج المندوبات العام

رابط الكتالوج النسبي العام هو [`/catalog`](/catalog). لا يتطلب تسجيل دخول، ويقرأ من مستند Firestore منفصل هو `publicCatalog/dana-plus` فقط. لا يقرأ هذا المسار أبدًا من `projects/dana-plus`، ولا يعرض سعر التكلفة أو المبيعات أو الأرباح أو المندوبات.

عند تسجيل دخول الإدارة ومزامنة البيانات، تُنسخ حقول المنتج الآمنة فقط إلى الكتالوج العام: `id` و`name` و`brand` و`category` و`representativePrice` و`images` و`description` و`sizes`. يمكن إضافة روابط صور متعددة (رابط في كل سطر)، ووصف، وأحجام مفصولة بفواصل من زر **تفاصيل** للمنتج. لا يوجد رفع صور أو مفتاح ImageBB في المتصفح.

### قواعد Firestore

أُضيفت القواعد في `firestore.rules`: بيانات الإدارة في `projects/dana-plus` تتطلب مستخدم Firebase مسجّلًا، أما `publicCatalog/dana-plus` فقراءته متاحة للعامة وكتابته تتطلب مستخدمًا مسجّلًا. يجب نشر القواعد يدويًا قبل إتاحة الكتالوج:

```powershell
# Firebase CLI غير مضاف كاعتمادية للمشروع؛ ثبتيه أو استخدمي نسخة موجودة لديك.
npm install --global firebase-tools
firebase login
firebase use <firebase-project-id>
firebase deploy --only firestore:rules
```

يحتوي `firebase.json` على مرجع القواعد المطلوب لهذا الأمر. لا تنشري قواعد مفتوحة لـ `projects/dana-plus`.

## النشر على Cloudflare Pages

1. أنشئي مشروع Pages باسم `dana-plus` من لوحة Cloudflare، ثم اربطيه بمستودع GitHub أو ارفعي مجلد `dist`.
2. شغّلي `npm run build` ثم انشري:

```powershell
npx wrangler pages deploy dist --project-name dana-plus
```
