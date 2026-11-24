# 校園發聲｜程式庫審查（2026-11-15）

## 審查結論

自架版正式啟用自動發文前，應先修正兩個重啟復原問題。已排入資料庫、尚未送出的貼文，可能在補送期限過後仍對外發佈。平台結果已落盤、但貼文或時段尚未結算時，重啟也可能留下永久「發佈中」的紀錄。現有測試涵蓋過期時段的首次領取及分平台失敗，未涵蓋這兩個中斷點。

共確認 8 項，P1 兩項、P2 六項。P1 影響正式發文或核心狀態可靠性，P2 影響指定設定或操作情境。本次判定依 [第一版需求](requirements.md)、[主題發文規格](v1-topic-publishing-spec.md)及[部署驗收](selfhost-deployment.md)，並區分現有程式的可達路徑與正式平台上待驗證的行為。

## 盤點與版本基準

- 基準為 `master`、`40cb0b316caada2d824efd05e05fc64a2b96fb36`，另納入審查開始時工作樹的已改與未追蹤檔案，如自架程式、分析儀表板與部署設定。附錄列出這些檔案的 Git blob 指紋。
- 自架版以 Node.js HTTP、React/Vite、SQLite 與磁碟圖檔執行，整合 Codex CLI／OpenAI、公開來源搜尋、四平台與 SMTP。組合入口為 [server.mjs:34](../selfhost/server.mjs#L34)，獨立工作程序為 [worker.mjs:6](../selfhost/worker.mjs#L6)。同一 SQLite 內的工作租約協調背景程序。
- 舊版 Sites 由 [app/page.tsx](../app/page.tsx)、[app/api](../app/api)、[sites-worker.ts:8](../build/sites-worker.ts#L8) 與 D1/R2 分工。登入、成效口徑與持久化各自獨立。本庫未見舊版資料移轉到自架版的執行入口，故舊版問題單獨定級。
- 排除真實環境變數及憑證、存量工作區資料、產物、第三方 UI 元件逐行審查及套件供應鏈。以工作樹的原始碼、範例設定與隔離測試為依據。程式原始檔保持唯讀，交付新增本文件。

## 批次計畫與實際覆蓋

| 批次與優先順序 | 流程、必讀入口與契約 | 完成條件與實際覆蓋 | 後續 |
| --- | --- | --- | --- |
| PUB · 1 | [發佈 API](../selfhost/server.mjs#L223) → [時段與工作](../selfhost/engine.mjs#L180) → [平台請求](../selfhost/publish.mjs#L36) → [SQLite 結算](../selfhost/engine.mjs#L218) | **深入檢查**。驗證核准雜湊、綁定版本、時段優先、唯一工作、部分成功、重試與重啟。workflow、topic-drafts、API 測試通過。 | 補上已持久化的過期工作、終態與父紀錄跨寫入中斷，以及帳號換綁。 |
| TOP · 2 | [主題 API](../selfhost/server.mjs#L73) → [主題與素材交易](../selfhost/topics.mjs#L51) → [AI 分階段工作](../selfhost/topic-drafts.mjs#L103) → [時段與核准](../selfhost/topic-drafts.mjs#L184) | **深入檢查**。核對衝突、換稿截止、執行中失效、保留舊稿、來源快照和結果。topic-drafts 測試通過。 | 以正式設定驗證提供者、代表性試讀案例、人工稿再核准。 |
| ING · 3 | [來源設定／匯入](../selfhost/server.mjs#L153) → [公開網路讀取](../selfhost/network.mjs#L19) → [整理與草稿](../selfhost/engine.mjs#L17) → [AI／圖檔](../selfhost/media.mjs#L11) | **深入檢查**來源更新、選稿與封存，**抽查** CLI／生圖與圖卡。automation、content-card、workflow 測試通過。 | 補讀 Linux Codex 實際執行邊界；測來源整理與修改並行。 |
| ANA · 4 | [分析 API](../selfhost/server.mjs#L65) → [日期歸檔](../selfhost/analytics-report.mjs#L12) → [平台查詢](../selfhost/analytics.mjs#L75) → [儀表板](../selfhost/web/AnalyticsDashboard.tsx) | **深入檢查**。核對發佈紀錄、近 7/30/90 天、缺值／零、快取、帳號與查詢上限。analytics、API 測試通過。 | 驗證正式平台權限與累計口徑。測手動核對及帳號切換的資料歸屬。 |
| OPS · 5 | [認證與設定](../selfhost/server.mjs#L33) → [儲存及租約](../selfhost/store.mjs#L53) → [郵件](../selfhost/mailer.mjs#L18)、[備份](../selfhost/backup.mjs#L7)、[容器](../compose.selfhost.yaml) | **深入檢查**認證、啟動、狀態取得、SQLite 及備份；**抽查** SMTP、代理與容器。media-mail、origin、API 測試及 Compose 設定檢查通過。 | Linux 容器實跑、對外 HTTPS、SMTP、正式備份復原演練及資料量量測。 |
| WEB · 6 | [自架入口與更新](../selfhost/web/main.tsx#L27)、[主題日曆](../selfhost/web/TopicCalendar.tsx)、[自動化設定](../selfhost/web/AutomationPanel.tsx)、[圖卡](../selfhost/web/CardEditor.tsx) | **抽查**登入／示範、編輯版本、預覽、排程核對、分析入口。型別檢查及獨立目錄正式建置通過。 | 全頁互動、無障礙及跨裝置驗收另做。 |
| SITES · 7 | [舊版認證](../app/chatgpt-auth.ts#L21) → [工作區 API](../app/api/workspace/route.ts) → [舊版 UI](../app/workspace.tsx)／[平台請求](../lib/publish.ts) → D1/R2 | **深入檢查**核准後發文及工作區版本；**抽查**來源、AI、CSV 與 Sites 預覽組態。領域測試 6 項通過。 | 若仍營運，驗證官方 ingress 身分標頭及重審行為。 |

## 已確認發現

### PUB-01 · P1 · 已排入佇列的發文會越過補送期限

**成立條件。** 一個排程時段已成功寫入 `slots`，對應 `publications` 還在 `pending`，程序在取出工作之前停止，並在補送期限過後才恢復。貼文本身仍有效，例如長青稿。此路徑也適用於早先已排入的時段被其他時段延誤。

**證據與影響。** [engine.mjs:180](../selfhost/engine.mjs#L180) 只在建立時段檢查 `catchUpMinutes`；已有同 ID 即返回，不能事後標記錯過。[engine.mjs:302](../selfhost/engine.mjs#L302) 恢復時僅處理過舊的 `preparing/sending`，隨後直接領取 `pending`。[engine.mjs:253](../selfhost/engine.mjs#L253) 發送前驗證稿件、有效期限和綁定，但沒有補送期限檢查。舊工作可進入平台 API，違反 [過舊排程記為錯過](requirements.md#L22) 的約定，也會影響有時效性的活動公告。

**驗證與修正。** 靜態確認。[既有測試](../selfhost/tests/workflow.test.mjs#L119) 呼叫逾時的 `createSlot`，尚未建立 `pending` 時成立。保存時段／手動發佈／人工補送的來源類別，對自動工作在領取時和最終送出前判定期限。驗收時先持久化待送工作再重啟，確認過期未呼叫模擬平台、時段有明確結果，成功或結果不明的其他平台紀錄保留。

### PUB-02 · P1 · 已確定平台結果仍可能永久顯示發佈中

**成立條件。** 全部平台已各自寫入終態，程序在更新貼文或時段狀態前中斷，或結算寫入失敗。

**證據與影響。** [engine.mjs:291](../selfhost/engine.mjs#L291) 先持久化平台結果，再於 [engine.mjs:300](../selfhost/engine.mjs#L300) 執行另一次交易結算。人工核對在 [server.mjs:271](../selfhost/server.mjs#L271) 也有同樣的分離寫入。[engine.mjs:308](../selfhost/engine.mjs#L308) 只找非終態工作，沒有重建已經完成的貼文和時段。發佈紀錄會顯示平台終態，但工作台及日曆仍可停在「發佈中」，人工核對入口也不能再處理已經定態的工作。此案影響核心狀態可信度，沒有證據顯示會因此重送。

**驗證與修正。** 靜態確認。平台結果與貼文、時段的衍生狀態在同一短交易寫入，並讓啟動時可依既有平台結果重算。驗收用已成功、部分失敗、人工已核對等組合在中斷後核對狀態，所有情境均不得再呼叫發佈 API。

### PUB-03 · P2 · 變更平台綁定會改變既有待送工作的實際目的地

**成立條件。** 同一平台換到另一個粉專、帳號或 LINE Channel，且尚有已核准的貼文或已入列工作。同帳號的 Token 續期屬正常操作。

**證據與影響。** [core.mjs:87](../selfhost/core.mjs#L87) 核准雜湊含平台代號，沒有帳號識別。工作保存平台但無目的帳號，見 [engine.mjs:206](../selfhost/engine.mjs#L206)。[server.mjs:139](../selfhost/server.mjs#L139) 更新憑證後不會重新核對待送稿，[publish.mjs:38](../selfhost/publish.mjs#L38) 執行時才讀現有設定，LINE 也直接使用當時的 Token。改綁可把原先打算送給一個帳號受眾的內容送給另一個帳號。分析總覽也會將新帳號規模與舊送出量並列，見 [analytics.mjs:134](../selfhost/analytics.mjs#L134)。

**驗證與修正。** 靜態確認。核准及發佈紀錄保存可比較的帳號識別，帳號切換時提示需重新確認的工作。同帳號續期應仍可發佈。用兩個模擬帳號測目的地、既有工作顯示與分析歸屬。

### TOP-01 · P2 · 人工綁定稿重新核准後可能被原時段略過

**成立條件。** 承辦人從日曆把人工稿綁到時段，之後編輯標題、文案或圖片，於貼文編輯器重新核准，保留原時段。

**證據與影響。** [server.mjs:204](../selfhost/server.mjs#L204) 修改後撤回內容核准，符合預期。重新核准時只有帶 `topicDraftJobId` 的 AI 主題稿會同步時段綁定的雜湊，見 [server.mjs:228](../selfhost/server.mjs#L228)。人工稿的新雜湊會與舊綁定不符，[engine.mjs:194](../selfhost/engine.mjs#L194) 會轉用一般稿或備稿。日曆保留舊綁定，承辦人只有再次選定時段才會更新，見 [TopicCalendar.tsx:92](../selfhost/web/TopicCalendar.tsx#L92)。

**驗證與修正。** 靜態確認。對仍有效的人工與 AI 綁定一併更新雜湊，或將待重新綁定明確顯示於編輯及日曆。驗收經正常 UI 完成人工稿綁定、編輯、重新核准，確認到點採用新核准版本，沒有換稿或重複出現。

### ING-01 · P2 · 背景掃描可能蓋掉訂閱來源的修改或恢復已刪除來源

**成立條件。** 背景工作正在等待一個來源的頁面或其文章；此時承辦人修改、停用或刪除該來源。

**證據與影響。** [engine.mjs:23](../selfhost/engine.mjs#L23) 先讀來源快照，再等待網路。成功／失敗收尾使用舊物件全列回寫，見 [engine.mjs:40](../selfhost/engine.mjs#L40)。[store.mjs:64](../selfhost/store.mjs#L64) 採 UPSERT，[server.mjs:152](../selfhost/server.mjs#L152) 的更新或刪除也沒有與掃描共用的版本。結果可能回復舊網址、啟用狀態、分類或選擇器，已刪除的來源也會重新出現。

**驗證與修正。** 靜態確認。更新掃描欄位前比對來源版本，使用只更新存在紀錄的操作，不覆寫設定。用延遲完成的假擷取器測新增後的編輯、停用及刪除，確認設定持久且後續輪次不再處理刪除來源。

### ANA-01 · P2 · 人工核對日可能被加入發文趨勢

**成立條件。** 平台送出結果原先為不明，之後承辦人在另一個日期查到成功，經發佈紀錄標為已送出。

**證據與影響。** [server.mjs:270](../selfhost/server.mjs#L270) 只接受結果及備註，更新 `updatedAt`，未寫入原平台發文時間。[analytics-report.mjs:22](../selfhost/analytics-report.mjs#L22) 在沒有 `completedAt` 時以 `updatedAt` 優先歸檔。[AnalyticsDashboard.tsx](../selfhost/web/AnalyticsDashboard.tsx) 表格標示「送出時間」。跨日核對會改動發文趨勢，跨期則改動本期與前期的比較。相同入口目前無欄位可補錄已知的貼文識別碼。

**驗證與修正。** 靜態確認。分開保存送出嘗試、平台發文及核對時間，允許採用平台發文時間並清楚標示舊紀錄的估算。驗收用跨日及跨期核對案例，確定已送出仍屬正確報表區間。無可確定日期的舊紀錄應有一致標示。

### OPS-01 · P2 · 定時輪詢每次載入完整資料，封存素材也不縮小回應

**成立條件。** 自架站長期新增已匯入原文、貼文、圖片及發佈紀錄，且一個或多個管理畫面保持開啟。

**證據與影響。** [main.tsx:37](../selfhost/web/main.tsx#L37) 每 15 秒取完整 `/api/state`。[server.mjs:91](../selfhost/server.mjs#L91) 對素材、貼文、圖片、發佈使用無範圍的 `store.list`，貼文分類缺省時還對每篇查找來源。封存只更新欄位，資料持續進入回應。[store.mjs:58](../selfhost/store.mjs#L58) 同步載入與解析，分析請求也每次讀取全部貼文和發佈紀錄。主機 CPU、傳輸和瀏覽器負擔隨歷史量增長，最常開啟的待審與日曆也承擔這些成本。

**驗證與修正。** 靜態確認讀取路徑，負載量界線待量測。先以代表性歷史資料量出回應大小與時間，拆分摘要輪詢與按頁讀取原文、歷史，分析按日期與平台查詢。驗收大型資料集的頁面切換、輪詢大小及資料正確性。

### SITES-01 · P2 · 舊版切換平台或開場版本時可沿用之前的人工核對

**成立條件。** 仍使用舊版 Sites 正式工作區，操作員勾選核對後變更平台或開場版本，接著執行發佈。

**證據與影響。** [workspace.tsx:39](../app/workspace.tsx#L39) 只在正文、圖片或來源改變時清除 `reviewed`。[workspace.tsx:56](../app/workspace.tsx#L56) 的平台與開場選擇走同一更新函式。[captions.ts:2](../lib/captions.ts#L2) 將開場版本用在發文連結，也根據平台選擇格式。[publish/route.ts:2](../app/api/publish/route.ts#L2) 以已儲存的布林值判斷核對。操作員可以在未重新確認目的地和內容的情況下發佈。

**驗證與修正。** 靜態確認。舊版仍開放時，儲存核准所對應的內容、平台及產出連結版本，發佈前比對。驗收後改變平台或開場，發佈須重新人工核對。

## 跨模組複核與接續

| 門檻或候選 | 複核結果與接續 |
| --- | --- |
| 延遲、部分成功、結果不明 | **確認 PUB-01、PUB-02。** 現有平台工作唯一鍵、條件更新及送出前版本交易仍能阻擋一般重複領取。已經標記 `unknown` 的工作須人工核對，故駁回「未知工作會自動重送」的候選。 |
| 既有時段、素材與核准 | **確認 TOP-01、ING-01。** 手動封存會通知主題失效。自動封存與主題工作使用的來源快照需要另定有效期語意，尤其是已備稿及超過素材保留期的遠期主題。AI 檢查引用存在但語意判斷由模型負責，應以規格中的匿名試讀及主張覆蓋案例驗收。 |
| 發佈、實際平台帳號與成效 | **確認 PUB-03、ANA-01。** 模擬測試覆蓋零值、缺值、權限及部分成功。正式帳號的 Meta 指標、LINE 截止／隱私口徑、實際圖文容器、SMTP 投遞仍待使用測試帳號驗收。 |
| 部署、身分與復原 | 自架 SQLite 快照恢復加密設定的隔離測試通過。待驗證 Linux 有效使用者、原生圖像依賴、Caddy/HTTPS、安全 Cookie、獨立 worker／備份復原與版本回滾。舊 Sites 的身分由宿主注入，本地 Vite 模擬器會移除輸入的同名標頭；正式 ingress 是否完成同等隔離屬部署待驗證項，沒有工作區證據顯示正式服務暴露。 |
| 前端與規模 | **確認 OPS-01、SITES-01。** 類型及建置檢查適用於程式版本。Web 操作以原始碼和既有 API 測試交叉確認；全頁瀏覽器測試與實際負載數字未取得。 |

修復順序為 PUB-01、PUB-02 → PUB-03、TOP-01 → ING-01、ANA-01 → OPS-01。前兩項共用重啟與工作狀態驗收，應先建立發佈復原契約。若舊版仍可正式發文，同步處理 SITES-01，依各版本各自的資料及授權入口驗收。

## 本機驗證

- Windows、Node.js 24.14.1。執行 `npm run selfhost:test`（50/50），測試使用隔離的暫存 SQLite／圖檔，平台及 AI 使用測試替身，並移除命令程序的服務憑證環境變數。既有測試通過代表所覆蓋的路徑正常，本報告的八項發現均為「靜態確認」。
- `node --test tests/domain.test.mjs`（6/6）及 `node node_modules/typescript/bin/tsc --noEmit --incremental false`（通過）。
- `vite build --config selfhost/vite.config.ts --outDir <暫存目錄>` 及 `docker compose --env-file .env.selfhost.example -f compose.selfhost.yaml --profile public config --quiet`（通過）。Compose 檢查涵蓋設定解析。
- 舊版於獨立暫存專案，在無社群／AI 憑證下執行 `npm run build`、Wrangler 的本地 D1 migration、`node --test tests/api.test.mjs`（1/1）。本機模擬登入、版本衝突、缺少平台憑證的發佈阻擋均通過。測試後停止該暫存站。

## 附錄｜工作樹指紋

Git blob 指紋依 `git hash-object` 取得。其餘追蹤檔比對上述 HEAD。

```text
ab2c990af6f3bb12361c421c12251ef6f87ea619  .dockerignore
2d100cb347c9f11aa2c86c8e3edb43739bb9b0b9  .env.selfhost.example
265677e752f483e5a676b0ae48d6c1a968f0b5d4  .gitignore
17e29a6b81efe9e1c431d7a22f4b53fdcf6dd28d  compose.selfhost.yaml
525d9e1cd36ea55e37eb394d9a79faaa5c245ba4  docs/automation-policy.md
3efb275c314eebee8d0410308d3f9fa52202d774  docs/codex-image-integration.md
8a97915269b583f5ee19b6e529b4946526d40e97  docs/engineering-report.md
d26d351a7c0f924216834fd62816b5dd4c30289e  docs/legacy-sites.md
887bdabf4b04de9100adb8b3c305a1ddc5889b10  docs/platform-content-rules.md
c0583570c7abfcc849614747737d200988b19cd2  docs/requirements.md
cd8e81aa7226f0edabcc8cf16f907f36abf6bbf0  docs/selfhost-deployment.md
6794d82ece01dc1d686cc085121023fc1b4a63ba  docs/social-api-setup.md
a7008605735aeb8e6a8afd1b9d027115aae75d21  docs/system-workflow-and-technology.md
00897a076ead5be83a97bc419fa96eea2790a09c  docs/v1-blind-reading-participant.md
3036eb796ca1cdd6c377e9b4acabbca101495f44  docs/v1-blind-reading-rubric.md
b7857c11c536a163ea05ee0cb00f7adf0d97f733  docs/v1-topic-publishing-spec.md
6427d130f5814b622d0d21830d456f97e7d3157a  docs/validation.md
26a1edc865bd10a4b3745e077ff8c828e8987599  package-lock.json
36b9fb3fcc92f8c6d1eb9ad3ab600d5a74de8050  package.json
544a489147feb62753d76bb1256d7159035cde69  README.md
53f13ea463aa416375a8e60bf2ae9cef59e89cbd  selfhost/ai.mjs
b2add5006c6770f26be43a1af1da8e8564c274e6  selfhost/analytics-report.mjs
f73462e66616958028c54bf87881802cdeab7542  selfhost/analytics.mjs
b87a70593e962ead291eced7b7920a7b75885cf9  selfhost/automation.mjs
5b5b1b5de684783d7ccbf4d0eb606ca9af351c17  selfhost/backup.mjs
334b9d9203357ac77a50a819e01d4dbed19e703d  selfhost/Caddyfile
e95a8f86635c1eaa5aeb424c5c081f91ccedd566  selfhost/card-layout.mjs
a8cf4c7e56c383c572a6215593ef0945b0835b14  selfhost/codex-image.mjs
65b6a80b6b74315298f33d7c0c09d113c3ee460a  selfhost/content.mjs
6fae6524a4b432a02decbc79753c6c39d74a2587  selfhost/core.mjs
a0ffea14658f93e01aa90009ad43fcaad20d9b97  selfhost/Dockerfile
7806cb29c7ccbf41fc1d545a207f0f02ffd64833  selfhost/engine.mjs
16d961e27c3067970bbe32a936725440b1f9877d  selfhost/http-origin.mjs
dcac176cad2f9a9832b4a9cb0c66bba8ec00f4bc  selfhost/mailer.mjs
a603a9f9771fb2a14e5c0bae3a302c1146ff28ff  selfhost/media.mjs
dcb0f63c04bdfc11bb702cdab7afde6af2af50cc  selfhost/network.mjs
8b14dafa14d63efc9e15482f3cee3cc750d126ba  selfhost/probe-codex.mjs
b94510811eb8531b081e99ff1a92608e2fbcd306  selfhost/publish.mjs
16515eecc05660cf9da2d328b2f6ea30ec911c33  selfhost/reset-admin.mjs
bee0c6c17cf71bec57f8a369b904abb37870c705  selfhost/server.mjs
d8ee38eca19b9278d7dff1ddeaf6423715c79410  selfhost/store.mjs
fb77e700bee78bd98b48b1cb1925e9a8472f170d  selfhost/tests/analytics.test.mjs
867ba255b2f59d65d5d250074651e1902cce4171  selfhost/tests/api.test.mjs
0f007b2ea7558c5d81ad3954135e321088048bd2  selfhost/tests/automation.test.mjs
be38546c7424e367ecd2bbd2ecac48eadc2fac21  selfhost/tests/content-card.test.mjs
143c4fd45659879d7b8b761734f49394897d8d18  selfhost/tests/media-mail.test.mjs
6280167ad0a3b5de3d4f253faf91a7bb4a0154cf  selfhost/tests/origin.test.mjs
c7437bed9a0bd3484addf76571d73bf5a6b32d04  selfhost/tests/topic-drafts.test.mjs
33d3a3e105c04374d26e3bb126216a13b19c3662  selfhost/tests/workflow.test.mjs
5af1d6bebad1dcbf165c48c3096f909504c964a8  selfhost/topic-drafts.mjs
1af8334342875a4681ed98a593aa58dec892587d  selfhost/topics.mjs
ef9d257e598f8772ef9a7be2f4056035494e7246  selfhost/vite.config.ts
129c8bb487cb8914f26b049111327667fab7f576  selfhost/web/analytics.css
3cb4574344dd84d5da0e00cb80e5122508ce0174  selfhost/web/AnalyticsDashboard.tsx
a7e170f4b02fce87412e952c549c993e38624cfc  selfhost/web/automation.css
223464fa7596e11d1efaa0e9d2e4e50015a8dbb2  selfhost/web/AutomationPanel.tsx
c1f091d4970729b88838706e0aba23708646e34c  selfhost/web/card-editor.css
4b1ebef8605772795241ca1d4302201faa60d047  selfhost/web/CardEditor.tsx
495cecfadbe08fe5cd163e0d988bba1a470d2ad2  selfhost/web/ContentCollection.tsx
24922315a503342f70acdff2d61dd43aba153f95  selfhost/web/demo.ts
3f772df56153f6bd4cc4ff1d73b7ce9e10c13c7d  selfhost/web/feedback-layer.css
066f0cae73b53cf1d10ab17c63390afbe3d13972  selfhost/web/FeedbackLayer.tsx
d3843f4b2107bca84e262b0d904808ec252d55f9  selfhost/web/index.html
545deb50aa453f0f19a18a0df37e32727fd986b8  selfhost/web/main.tsx
81ef424fc3912c4e973e4c8b88437f24c82e2bb5  selfhost/web/style.css
d479ed45bcc37db233b2b11192b0f685e27256a4  selfhost/web/topic-calendar.css
897512cd4ef94f8dc86ee49f29782c1437d1c40a  selfhost/web/TopicCalendar.tsx
c33a7b4d842bb6ced97d455760d85b330cba869a  selfhost/web/types.ts
f938f3417e60e0c19115d08a5cc8d1a873da7af7  selfhost/worker.mjs
```
