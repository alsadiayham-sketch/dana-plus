# Dana Plus

واجهة عربية RTL لإدارة منتجات دانا، مبيعات المندوبات، الأرباح، ورسوم التوصيل. تُخزّن بيانات العمل في Firestore داخل `projects/dana-plus` وتُزامن لحظيًا بعد تسجيل دخول Dana.

## التشغيل

```powershell
Copy-Item .env.example .env.local
npm run dev
```

ضعي قيم Web App من Firebase في `.env.local`. لا تضيفي هذا الملف إلى Git.

## النشر على Cloudflare Pages

1. أنشئي مشروع Pages باسم `dana-plus` من لوحة Cloudflare، ثم اربطيه بمستودع GitHub أو ارفعي مجلد `dist`.
2. شغّلي `npm run build` ثم انشري:

```powershell
npx wrangler pages deploy dist --project-name dana-plus
```
