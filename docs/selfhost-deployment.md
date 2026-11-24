# Linux 私有部署與驗收

這是每單位一套的獨立執行模式；使用 Node.js 24、SQLite、磁碟圖片、Codex 私有產稿工作與 SMTP。原有 Sites / Cloudflare 模式保留在原始程式，但不承擔此模式的排程或主機訂閱登入。

## 1. 在 Linux 準備環境

安裝 Docker Engine 與 Compose，將這個**私有**專案放到主機。準備指向主機的網域，開放 80/443；如果已有反向代理，可直接轉接 `127.0.0.1:5180`，不必啟用附帶的 Caddy。

```sh
cp .env.selfhost.example .env.selfhost
chmod 600 .env.selfhost
```

修改 `PUBLIC_DOMAIN`、同網域的 `PUBLIC_BASE_URL=https://…`、管理者 `ADMIN_EMAIL` 與至少 12 字元的 `ADMIN_PASSWORD`。沒有預設管理者密碼。這些登入資訊僅用於首次建立；日後改密碼不會被環境值覆蓋。

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml --profile public up -d --build
docker compose --env-file .env.selfhost -f compose.selfhost.yaml ps
```

已經有 HTTPS 反向代理時，省略 `--profile public`，代理到應用服務。請讓應用的 `PUBLIC_BASE_URL` 與實際網址相符；它同時用於 Cookie 安全、來源檢查、郵件連結與社群圖片讀取。每個單位使用不同 Compose project name（`-p unit-name`）、資料卷與網址；多套部署時調整主機端連接埠，不能共同使用同一資料卷。

## 2. 驗證訂閱產稿

本版本使用 Codex CLI 的**可信私有定期工作**，不使用原生 app-server 訂閱登入對外提供服務，也不讀取／複製其他應用的 token。單一主機工作帳號，產稿序列化，CLI 自行更新登入憑證；不要將同一登入檔複製給多台同時執行的工作機。

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec app codex login --device-auth
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec app codex login status
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec app node selfhost/probe-codex.mjs
```

第一個命令由使用者自行在瀏覽器完成登入；帳號／工作區需允許 device auth。最後一個命令使用明確標示的測試原文，會使用少量訂閱額度，僅印出完成狀態與文案長度，不會發文。主機登入檢查與成功產稿是兩個不同的驗收項目。

正式網站登入後，在「單位設定 → AI 與用量」檢查主機登入、啟用 AI。若授權或額度異常，系統暫停新產稿並寄信；已核准發文繼續。人工確認後按「恢復產稿」。付費 API 或生圖必須明確選用，不會因訂閱失敗自動切換。

適用資格依官方文件與實際帳號政策判斷。本專案的單位專用工作流程與官方「可信私有自動化」描述相符，是實作上的判斷，並非 OpenAI 對任意私有網站或商業服務的授權保證。如要改為多客戶服務，需重新確認適用資格與整合方式。

- [CLI 授權](https://learn.chatgpt.com/docs/auth?surface=cli)
- [可信私有自動化](https://learn.chatgpt.com/docs/auth/ci-cd-auth)
- [定期／非互動工作](https://learn.chatgpt.com/docs/non-interactive-mode)
- [app-server 的不同適用條件](https://learn.chatgpt.com/docs/app-server)
- [Sign in with ChatGPT 的應用資格](https://developers.openai.com/siwc/quickstart)

## 3. 設定四平台與郵件

在「社群帳號」輸入各帳號 ID、token 與目前官方支援的 Meta Graph 版本。欄位可改由同名環境變數提供；環境變數優先，網頁不會覆寫它。網頁輸入值以 AES-256-GCM 加密保存，原值不會傳回瀏覽器。

Facebook 使用 Page token，IG 使用 Facebook Login 路徑的專業帳號及 Page token；Threads 使用自己的 user token。LINE 使用 Messaging API channel access token，群發給既有好友，多圖使用 Flex carousel。平台授權與 App Review 仍須由持有帳號權限的管理者完成。

若 Meta 要求伺服器提供 `appsecret_proof`，請在 Facebook 設定填入簽發 Page token 的 Meta 應用程式 App Secret，或設定 `FACEBOOK_APP_SECRET`。主機用它產生驗證碼，App Secret 本身不會隨 Graph API 請求傳送。[Meta 安全請求說明](https://developers.facebook.com/docs/graph-api/guides/secure-requests/)

先「檢查帳號連線」，再用指定測試帳號／專頁核准一篇測試內容，執行立即發佈，逐平台到後台核對。連線可讀取帳號資訊不代表已具備發文權限。正式帳號未經驗收前，保持自動排程關閉。

在「單位設定 → 郵件通知」填入 SMTP、收件信箱、每日摘要時間，寄送測試郵件。465 使用直接 TLS，其他埠要求 STARTTLS。郵件失敗會保存結果並有限次重試；SMTP 沒有設定時，通知先保留在寄送佇列。

## 4. 來源、圖片與週期

新增公開網站列表或 RSS / Atom。一般列表只擷取同站文章連結，可設定連結需包含的字串與正文 CSS selector；每輪每站最多讀取八篇新候選，保留原文及圖片候選。登入頁、PDF、動態渲染頁不是此版自動擷取的支援範圍，可貼上原文。來源與圖片網路讀取會檢查 DNS 及每次重新導向，拒絕內網、loopback 與 metadata 位址。

關注主題與包含關鍵字任一符合即可；排除關鍵字優先，留白保留全部。已知發布時間超過來源最長天數的文章不自動製作；未提供發布時間的文章保留待人工核對。每週自動產稿依台北週一開始計數，手動指定素材另計。系統不會把頁面存在當作圖片使用授權，承辦人核准時需確認權限。

每篇最多十張照片。圖片先作為私人素材保存；已核准內容進入發佈時，才建立平台可讀的公開衍生 JPEG。這些發佈圖片是公開資源，並非登入保護的內部素材。各平台比例以留白保留完整內容；原圖不被覆寫。套版圖卡包含品牌色、Logo、標題與人工填寫的補充日期。

設定共用每週發文日／時間，核准內容後啟用排程。每篇只送一次；一般核准內容優先，無合適內容時用有效備稿，無備稿就略過並通知。四平台各自有結果，部分失敗只補送失敗平台。結果不明須先到平台查證，再於工作台記錄已送出或確認未送出，後者才允許補送。

啟動、重啟或離線後，只在允許的延遲補送分鐘內補送；超時不集中發出舊內容。已開始送出的工作若被中斷，保留結果待核對。獨立 CLI 工作上限三分鐘；平台圖片處理有獨立輪詢及時間限制。

## 5. 備份、更新與復原

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml exec app node selfhost/backup.mjs /app/backups
```

SQLite 使用一致性快照，包含圖片與 `machine.key`。加密憑證必須搭配該 key 才能解密；整份備份與 `.env.selfhost` 都屬私密資料，請另保護並保存到主機之外。備份不包括 Codex 登入卷；復原到新主機時重新登入，不與原機共用複製的認證。

復原前先停止服務，將備份的 `campus.sqlite`、`machine.key`、`media/` 放回資料卷，保留原卷作為回復點，再啟動並檢查發佈紀錄與排程。主機停止前有送出中的工作，先到平台核對；不要清除 publication 紀錄來強迫重送。

更新使用 `up -d --build`，不移除資料卷。重設忘記的密碼：修改受保護環境的 `ADMIN_EMAIL`／`ADMIN_PASSWORD` 後重建 app 容器，再執行 `node selfhost/reset-admin.mjs`；所有 session 會失效。

## 本機開發與檢查

```sh
npm ci
npm run selfhost:dev
# http://127.0.0.1:5180，可先探索明確標示的示範工作區
npm run selfhost:test
npm run selfhost:build
npm run selfhost:start
```

Node.js 需 >=24.14。`selfhost:dev`／`selfhost:start` 自動讀取忽略追蹤的 `.env.selfhost`。正式模式只提供已建置的靜態前端，沒有開發工具。若要獨立背景程序，web 設 `EMBEDDED_WORKER=false`，同一使用者執行 `npm run selfhost:worker`、指向同一 DATA_DIR；工作租約會協調重複啟動，但每個 Codex 登入仍只供一條私有工作流。

本機預算保留金額僅是請求准入控制，失敗也保留以免低估。它不讀取訂閱剩餘額度，也不是 API 精確帳單或上游硬性費用上限。實際費用與服務端限制需在提供者後台管理。

## 主題圖卡與文章長度

在貼文編輯器選「依這篇主題做圖卡」，或到「圖片工作室」選擇既有圖片加字。AI 配圖描述以該篇主題及摘要為依據，圖片不含文字；標題與摘要在編輯器另外加上。可拖曳文字圖層，調整字級、對齊、色彩、背景縮放與位置，選擇方形、直式或橫式。越出畫布會提示，儲存會保留原圖、建立新圖片與可再次編輯的版面設定。套用至貼文會撤回先前核准；已有發佈紀錄的貼文不覆寫。

單位設定預設每平台正文 200～300 字，計數含標點，不含空白、網址與獨立 hashtag。產稿會要求背景、來源重點及總結，產稿後檢查；不符合時使用相同服務修訂一次，仍未符合則明確失敗，不直接截斷或編造補字。手動編輯顯示字數供審核；不擅自重寫既有草稿。

常駐網站的自動生圖仍為選用 Images API 功能，需管理者啟用並設定伺服器端金鑰。Codex 對話中提供的內建生圖工具不會自動變成常駐網站的生圖授權。可先上傳該工具生成的配圖，再於網站完成文字排版。

## 官方平台依據

- [Facebook 發佈](https://developers.facebook.com/documentation/pages-api/posts.md)
- [Instagram 內容發佈](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)
- [Threads 發佈](https://developers.facebook.com/documentation/threads/posts.md)／[容器狀態](https://developers.facebook.com/documentation/threads/troubleshooting.md)
- [LINE Flex carousel](https://developers.line.biz/en/reference/messaging-api/nojs/#f-carousel)／[防重送](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
