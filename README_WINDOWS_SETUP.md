# Vercel 版停車場系統（最新 API 重寫版）

## 本機啟動
1. 安裝 Node.js LTS
2. 在專案根目錄建立 `.env.local`
3. 執行：
   npm install
   npx vercel dev

## 必要環境變數
APP_USERNAME=
APP_PASSWORD=
SESSION_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=

## LINE 管理員綁定
管理員傳送：
ADMIN-BIND

解除：
ADMIN-UNBIND

## 排程
`vercel.json` 已設定每天台灣早上 9 點（UTC 01:00）執行 line-reminder。
