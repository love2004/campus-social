# 校園發聲 Campus Social

各單位承辦人專用的 AI 社群發文平台，可獨立部署在 Linux 常駐主機。從使用者提供資料或指定公開網站，整理成四平台圖文草稿；人工核准後，依共用週期排程發佈。

## 這一版

- Facebook 粉專、Instagram、Threads、LINE 官方帳號好友群發，文字及單張／多張圖片，各平台獨立文案與結果。
- 公開網站／RSS 定期整理、主題及關鍵字篩選、每週篇數上限；也能貼上原文、指定文章與上傳照片。
- 各平台集中預覽、圖片排序、品牌色／Logo／標題套版；AI 概念生圖可選 Codex 訂閱或另外計費的 Images API。
- 核准內容自動加入佇列。一般內容優先，沒有合適內容時使用有效備稿，皆無則略過並提醒。
- 台北時區共用週期；主機重啟後保留佇列、排程及平台結果，避免重複發文。未知結果需人工核對才能補送。
- 訂閱產稿使用單位主機的可信私有 Codex 工作流，序列化執行；額度／授權異常時暫停產稿，已核准發文繼續，不自動切換 API 計費。
- 登入管理、加密保存連線設定、電子郵件摘要與異常通知、資料備份工具。
- 「社群分析」提供近 7、30、90 天的發文趨勢、帳號規模與單一平台貼文成效；所需分析權限見下方 API 憑證指南。
- 主題稿可設定製作 1、3、4 或 5 張圖卡；多張共用同一底圖，逐頁內容隨草稿審核。可在自動化規則啟用「主題備稿主動搜尋」，AI 會提出一般公開關鍵字；公開網站、訂閱、文章匯入與補充搜尋皆由主機已登入的 Codex Web Search 讀取。找不到相關且可信的來源時，不應強行融入時事或熱梗。

## 本機打開

### Windows 一鍵啟動

先依下方指令打包，再雙擊專案根目錄的 `CampusSocial.exe`。EXE 內含 Windows x64 的 Node.js、前端和自架後端。保留程式視窗即可維持背景排程運作，關閉視窗時會等待執行中的工作完成。視窗使用 Microsoft Edge WebView2 Runtime，若電腦缺少此元件，可從 [Microsoft 下載 WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download)。

程式沿用 EXE 同資料夾的 `.env.selfhost` 與 `selfhost-data`（或設定檔指定的 `DATA_DIR`）。可從頂欄的「設定 → 程式設定」編輯啟動設定，儲存後重新開啟程式即可生效。Windows 啟動器固定監聽 `127.0.0.1` 並內建排程，預設連接埠為 `5180`，可調整 `PORT`。

首次使用時，從「設定 → 建立管理員」輸入信箱並設定至少 12 個字元的密碼。完成後程式會自動登入並開啟工作台。密碼會以雜湊存入本機資料庫。已有帳號時，從「設定 → 變更管理員密碼」直接開啟修改視窗，以目前密碼驗證後更新。AI、郵件與社群帳號可登入工作台後設定。

EXE 可以複製到其他可寫入的資料夾，首次執行會將內含的程式解壓到 `%LOCALAPPDATA%\CampusSocial\runtime`。搬移既有工作區時，請先停止服務，再另行搬移設定檔與資料目錄。社群發文、AI 和郵件功能沿用各自的服務設定與授權要求。

重新打包時，請在 Windows x64 安裝 Node.js 24.14 以上，於專案根目錄安裝依賴並執行以下指令。打包會從 NuGet 取得 WebView2 SDK，並更新根目錄的 `CampusSocial.exe`。

```powershell
npm run install:ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

前一代 Cloudflare 版若要保留文章網址匯入，可設定 `CODEX_WEB_BRIDGE_URL` 指向可到達的 HTTPS 自架主機，並在兩端設定相同的 `CODEX_WEB_BRIDGE_TOKEN`（至少 32 字元）。桌面版直接使用主機的 Codex CLI。

### 使用 Node.js 啟動

安裝 Node.js 24.14 以上，在專案根目錄執行：

```sh
npm run install:ci
npm run selfhost:dev
```

開啟 [本機工作台](http://127.0.0.1:5180)，可先探索明確標示的示範工作區。示範只在頁面記憶體操作，不會呼叫 AI、寫入正式資料或真的發文。

正式工作區先將 `.env.selfhost.example` 複製成忽略追蹤的 `.env.selfhost`，設定管理者信箱與至少 12 字元的密碼，再啟動。沒有預設管理者帳號或密碼。

```sh
npm run selfhost:test
npm run selfhost:build
npm run selfhost:start
```

## Linux 主機部署

依 [部署與驗收指南](docs/selfhost-deployment.md) 設定網域、HTTPS、Codex 主機登入、社群帳號與 SMTP。提供 `compose.selfhost.yaml`、Dockerfile、Caddy 反向代理、備份與管理者重設工具。

Facebook、Instagram、Threads 與 LINE 的權限、Token 取得步驟與欄位對照見 [四平台 API 憑證取得指南](docs/social-api-setup.md)。

來源擷取、產稿時段、AI 選稿門檻、素材時效與封存方式見 [自動化規則檢查單](docs/automation-policy.md)，可在「單位設定 → 自動化規則」預覽並調整。[四平台文案與圖卡研究](docs/platform-content-rules.md) 列出編輯建議及官方規格。

完整的素材擷取細節、排除詞邏輯、審核發佈流程及功能技術對照見 [系統完整流程與技術說明](docs/system-workflow-and-technology.md)。

Codex 生圖使用方式、輸出匯入與訂閱／API 區分見 [Codex 生圖整合](docs/codex-image-integration.md)。

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml --profile public up -d --build
```

四平台的真實授權、發文結果、SMTP 寄送與實際 Linux 主機的訂閱資格，需使用部署者持有權限的帳號完成驗收。連線檢查、模擬測試與真實發文驗收分別呈現，不會將其中一項冒充另一項。AI 本機預算保留值是請求控制，不是提供者的精確帳單或硬性費用上限。

已確認的需求記錄在 [第一版規格](docs/requirements.md)。原有 Cloudflare / Sites 版本與舊操作方式保留於 [舊版說明](docs/legacy-sites.md)，不影響新 Linux 執行模式。
