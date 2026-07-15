# Dana Plus

واجهة عربية RTL لإدارة منتجات دانا، مبيعات المندوبات، الأرباح، ورسوم التوصيل. بيانات العمل تُحفظ محليًا في متصفح جهاز المديرة.

## التشغيل

```powershell
npm run dev
```

## النشر على Cloudflare Pages

1. أنشئي مشروع Pages باسم `dana-plus` من لوحة Cloudflare، ثم اربطيه بمستودع GitHub أو ارفعي مجلد `dist`.
2. أضيفي الأسرار التالية في **Settings → Variables and Secrets**:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `AUTH_SECRET` (قيمة عشوائية طويلة، 32 حرفًا أو أكثر)
3. شغّلي `npm run build` ثم انشري:

```powershell
npx wrangler pages deploy dist --project-name dana-plus
```

لا تضعي بيانات الدخول في `VITE_*` أو في ملفات المصدر، لأنها تصبح متاحة للمتصفح.
