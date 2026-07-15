# Dana Plus

واجهة عربية RTL لإدارة منتجات دانا، مبيعات المندوبات، الأرباح، ورسوم التوصيل. تفتح لوحة التحكم مباشرةً، وتُحفظ بيانات العمل محليًا في متصفح جهاز دانا.

## التشغيل

```powershell
npm run dev
```

## النشر على Cloudflare Pages

1. أنشئي مشروع Pages باسم `dana-plus` من لوحة Cloudflare، ثم اربطيه بمستودع GitHub أو ارفعي مجلد `dist`.
2. شغّلي `npm run build` ثم انشري:

```powershell
npx wrangler pages deploy dist --project-name dana-plus
```
