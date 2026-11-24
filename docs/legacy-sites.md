# 校園發聲 Campus Social — 大葉大學

以招生為目的的社群內容工作台。從自選網頁／貼上原文，到 AI 文章與圖片、人工核對、多平台發佈，再以曝光、點擊、招生轉換數據回饋下一輪創作。

## 現在可以操作的功能

- 繁體中文、桌面與手機介面：總覽、來源庫、內容管理、AI 工作室、內容日曆、成效分析、社群頻道與設定。
- 來源解析：伺服器端讀取 HTML，限制 2MB、重新導向逐次驗證、網站白名單、逾時、移除腳本與導覽。預設允許 `dyu.edu.tw` 與其子網域。JavaScript 渲染頁、登入頁、PDF 不支援，請貼上原文。解析不是完整爬蟲或自動訂閱。
- AI 文章：OpenAI Responses API、JSON Schema 輸出、目標讀者／語氣／開場提示、來源約束、歷史回饋。預設模型可用環境變數替換。
- AI 圖片：OpenAI Images API，圖片儲存在 R2 私人空間；可改用自行上傳至公開空間的 HTTPS 圖片。
- D1 雲端儲存正式資料，以登入者 ID 隔離；樂觀鎖避免多視窗互相覆蓋。
- 示範模式：模板文案、程式繪製的示意插畫、明確標示的範例數據；不會呼叫 AI 或實際發佈，僅保存在目前頁面。示範資料不能寫入正式工作區。
- 成效手動輸入、CSV 匯入／匯出、日期區間、曝光趨勢、招生漏斗、UTM 連結。
- 比較三種開場的平滑 CTR（`(clicks + 2) / (impressions + 100)`）；各組至少 200 次曝光才參與排序。將觀察結果帶入下一次生成提示。這是啟發式建議，並非控制變因的 A/B 實驗或效果保證。

## 發佈支援範圍

| 平台 | 已實作的發佈方式 | 啟用條件 |
| --- | --- | --- |
| Facebook | 粉絲專頁文字、公開圖片 | Page ID、Page access token、Graph API 版本與所需權限 |
| Instagram | 單張公開 JPEG 圖文，建立容器後發佈 | 專業帳號、與 Facebook Page 連結、本實作使用 Facebook Login 權限／token |
| LINE 官方帳號（原 LINE@） | Messaging API 群發文字／圖片 | Channel access token、帳號訊息額度與既有好友 |
| Threads | 文字／公開圖片，建立容器後發佈 | Threads user ID、token 與發文權限 |
| LinkedIn | 文字貼文 | User token、author URN、API 版本與 Community Management 存取權 |
| X | 文字貼文、保留 UTM 連結並截短內文 | OAuth 用戶 token 與 `tweet.write`；不使用 app-only token |
| TikTok、YouTube、Pinterest | UI 中展示串接規劃 | 尚未實作，不可發佈 |

**目前未填入任何金鑰，尚未進行真實 AI／社群端到端驗證。** 「程式已實作」與「帳號已通過平台驗證」不同。Meta／Threads 開發文件部分在本次研究環境無法直接取回；連接真實帳號時仍須依當前官方規格驗收。

發佈必須先儲存並勾選人工核對。每個平台獨立檢查、發佈與回報；D1 的唯一 claim 避免同一貼文／平台重複送出。缺少設定時回傳 blocked，允許補齊後再試；已成功、送出中或結果不明的紀錄不會自動重送。若平台成功但網路／資料庫出錯，保留需核對紀錄。此版本沒有重新授權、token 自動更新或人工解鎖重試介面，需管理員先核對平台與資料庫紀錄。

AI 圖片使用 JPEG 輸出；此 IG adapter 接受公開 JPEG。也可以將自有 JPEG 上傳至公開圖片空間，填回網址。若要讓 Facebook／Instagram／LINE／Threads 使用 R2 的生成圖，需設定與同一 bucket 對應的公開 R2 custom domain `PUBLIC_MEDIA_BASE_URL`；私人 Site 的圖片網址不能直接供社群平台抓取。公開圖片屬另外的外部資源，不因 Site 私人設定而自動保持私人。

## 第一次使用

1. 先探索示範工作區；數據、新聞內容與校景插畫都是示意，並非大葉大學官方事實。
2. 切換正式工作區。私人 Sites 版使用 ChatGPT 登入；本機開發可用 `/signin-with-chatgpt?return_to=/` 的 starter mock 登入，不會出現在正式版本。
3. 在來源庫加入新聞內頁；若解析內容不足或動態載入，改用「貼上原文」，保留正確的來源網址。
4. 在 AI 工作室選擇來源、讀者與語氣；設定金鑰後生成圖文，也可以自行編寫。
5. 核對事實、日期、招生資訊與圖片權限，選擇平台、儲存草稿、檢視並發佈。
6. 從社群後台與招生網站收集相同口徑的每日數據，輸入或匯入成效。下一次創作會參考更新後的開場表現。

## 環境設定

參考 [.env.example](../.env.example)。本機開發和建置預設使用 [.openai/hosting.example.json](../.openai/hosting.example.json) 的繫結名稱。已有 Sites 專案時，可將其部署清單放在 Git 忽略追蹤的 `.openai/hosting.json`，建置時會優先採用該檔案。API 金鑰與 token 放在忽略追蹤的 `.dev.vars`，正式站使用 Sites 的 runtime secrets 工具設定。

OpenAI 金鑰應透過 OpenAI Developers plugin 的 `openai-platform-api-key` 工作流程設定；本次環境未安裝該 plugin。社群 token 由學校管理員從各平台開發者後台取得，完成權限與 App Review 後，再由管理員設定到伺服器。

目前沒有內建社群 OAuth 登入畫面、多租戶帳號憑證管理或 token refresh。此版為學校單一工作區；私人預覽只對擁有者開放，尚未開放團隊協作權限。

## 本機開發

Node.js >= 22.13。專案使用 Vinext / React 19 / Cloudflare Workers / D1 / R2，保留 Sites build integration。

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_woozy_molly_hayes.sql
npm run dev
```

在 `http://127.0.0.1:5173/` 預覽。Migration 只需在新的本機 DB 套用一次；正式站由 Sites 部署流程套用。

本次 Windows 的 npm shim 無法解析正確 npm 路徑時，使用：

```powershell
node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ci --no-audit --no-fund
node scripts/run-framework.mjs build
node scripts/run-framework.mjs dev
```

## 驗證

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/domain.test.mjs
# 先啟動 dev server 並套用本機 migration，再執行：
node --test tests/api.test.mjs
```

7 項測試涵蓋範例／正式資料隔離、數據與貼文關聯、台北日期、UTM、漏斗數據驗證、最少樣本／平滑 CTR、未登入拒絕、同時儲存衝突、缺少憑證、不開放來源與人工核對。API 測試只用本機 mock 帳號，不會呼叫真實社群，最後還原本機工作區資料。

另以瀏覽器驗證桌面、手機導覽、示範生成與三平台模擬發佈、正式工作區登入、動態網頁錯誤提示。

## 下一階段

- 完成 FB／IG／LINE 的真實帳號授權與圖片端到端驗收，接著驗收 Threads／LinkedIn／X。
- 社群 OAuth、權限檢查、token 到期提醒與更新；成功／失敗／部分失敗的人工補送工具。
- 自有 JPEG 資產上傳與媒體驗證、IG／Threads 容器狀態輪詢。
- 從各平台 Insights 與招生網站同步數據；目前數據必須輸入／匯入，尚無自動追蹤 click endpoint。
- 明確定義「諮詢」「有效名單」「完成報名」等事件，加入 GA4／表單 webhook；目前合併為單一轉換數字。
- 可重試的背景任務與正式自動排程。內容日曆目前僅編輯計畫，不會在指定時間自動送出。
- 同平台、受眾、時段控制的 A/B 測試；以有效招生名單率評估優化，而非只追求 CTR。
- TikTok／YouTube 的影音製作與授權流程，以及 Pinterest Pin adapter。

## 官方參考

- [大葉大學](https://www.dyu.edu.tw/) / [招生網站](https://enroll.dyu.edu.tw/)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) / [Images API](https://developers.openai.com/api/reference/resources/images)
- [Facebook Pages](https://developers.facebook.com/docs/pages-api/posts/) / [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/) / [Threads](https://developers.facebook.com/docs/threads/)
- [LINE Messaging API](https://developers.line.biz/en/reference/messaging-api/)：群發是 Messaging API broadcast，並非 LINE VOOM 貼文。
- [X Create Posts](https://docs.x.com/x-api/posts/create-post) / [LinkedIn Posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [TikTok Direct Post](https://developers.tiktok.com/doc/content-posting-api-get-started) / [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
