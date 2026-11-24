# 四平台文案、圖卡與自動選稿規則

2026-11-06 查核。適用單位／學校社群編輯。以下「官方限制」來自平台文件，「建議」是依本專案 200～300 字要求提出的初始編輯政策，應由承辦人檢查後啟用。

## 官方限制與本版範圍

| 平台 | 查核到的官方規格 | 本版實作／編輯政策 |
| --- | --- | --- |
| Facebook | Pages API 支援文字、連結與照片發佈。可在 feed 請求帶入 message 與 link | 每版正文 200～300 字。最多 10 圖是本系統的共同上限 |
| Instagram | 圖片為 JPEG，最大 8MB，比例 4:5～1.91:1。caption 上限 2,200 字元，可含 hashtag。官方輪播上限可達 20 個媒體 | 每版正文 200～300 字，工作台保留最多 10 圖。至少一張圖 |
| Threads | 文字貼文上限 500 字元，網址亦包含在 text。文字貼文可有連結預覽，最多 5 個不同連結。圖片須位於可公開讀取的網址 | 正文 200～300 字，最多一個來源連結，少量 emoji，送出前另外檢查平台全文限制 |
| LINE | text 訊息上限 5,000 字元。圖片訊息與 Flex 可含圖片及 URI action。Flex 圖片規格列最大 1024×1024，單圖 preview 最大 1MB。群發計入方案月訊息量 | 正文 200～300 字，加單圖或 Flex 輪播。圖卡需保證小螢幕可閱讀 |

對應文件為 [Facebook 貼文](https://developers.facebook.com/documentation/pages-api/posts.md)、[IG Media 規格](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md)、[IG 發佈流程](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)、[Threads 貼文](https://developers.facebook.com/documentation/threads/posts.md)、[LINE 訊息規格](https://developers.line.biz/en/reference/messaging-api/nojs/#message-objects)、[LINE 計費](https://developers.line.biz/en/docs/messaging-api/pricing/)。

## 四個文案版本的建議起始設定

所有平台均應先傳遞來源中的資訊，讀者在正文就能了解主題、重點及結論。200～300 字的本機計數含標點，排除空白、網址及獨立 hashtag。平台的全文限制仍須額外驗證。

| 平台 | 建議正文結構 | 連結與標籤建議 | 圖卡建議 |
| --- | --- | --- | --- |
| Facebook | 主題與背景 → 2～3 個來源重點 → 對學生／家長／教職員的具體意義 → 一句總結 | 文末一個真實來源或報名連結，0～2 個相關 hashtag | 共用方形 1080×1080，主標題加 2～3 個短重點。活動實照須對應同一篇事件 |
| Instagram | 有資訊量的首句 → 2～3 個短段或重點 → 一句總結 → 有依據的下一步 | 0～3 個精準 hashtag。只有確定已設定的個人檔案連結才寫「連結在個人檔案」 | 可用 1080×1350 直式或方形。標題約 12～24 字，摘要約 30～60 字，重要文字避開邊緣 |
| Threads | 一個清楚觀察 → 2～3 個具體事實或影響 → 一句總結，適合時才加真實問題 | 最多一個來源連結，0～1 個相關主題標籤，不堆疊 hashtag | 以一張資訊卡為主，圖卡補充正文。少量字與 emoji，留出全文長度餘裕 |
| LINE | 【消息主題】→ 已知日期／對象／地點／期限 → 2～3 個重點 → 單一行動與連結 | 以一個清楚連結為主，預設不加 hashtag | 方形圖卡，主標題與關鍵資訊能在聊天預覽閱讀。多圖用一組輪播，避免同一事件重複群發 |

上表的篇幅、結構、hashtag 數量、尺寸與圖卡字數是編輯建議，並非平台保證觸及率的設定。官方支援的媒體類型見 [Facebook](https://developers.facebook.com/documentation/pages-api/posts.md)、[Instagram](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)、[Threads](https://developers.facebook.com/documentation/threads/posts.md)、[LINE](https://developers.line.biz/en/docs/messaging-api/message-types/)。

可直接放入產稿提示的共同要求為「先整理事實，再依平台調整表達方式。每版正文 200～300 字，至少包含 2 個可由原文核對的資訊點及一個具體總結。日期、地點、成效數字、人物及報名連結都必須有來源。資訊不足時回報原因。」

## 供承辦人檢查的選稿政策建議

先套固定條件，再讓 AI 做適合度判斷。固定條件提供可重現的界線，AI 回傳結構化理由，供人核對。

1. 來源必須是承辦人啟用的公開網站、RSS 或手動素材，保留原始網址與擷取時間。
2. 文章日期採「來源公布日期」優先，缺少時以擷取日期作為暫定起點並標記日期未知。擷取日期不能當成來源的新發表日期。
3. 使用可設定的最長來源天數，初始可維持目前 30 天。活動截止或結束時間若已過，停止產生招募／報名文案，必要時改交人工評估成果回顧。
4. 同網址去重後，再檢查同標題／同一事件的既有稿，避免同一新聞由多個來源重複產稿。
5. 主題與包含關鍵字符合、排除關鍵字未命中，才進入 AI 判斷。新聞列表、導覽頁、只有標題與導流句的來源，應要求取得單篇原文。
6. AI 判斷讀者相關性、資訊充分度、時效及可核對性。初始可用適合度 70／100 為候選門檻，但「資料不足、列表頁、過期活動、重複事件」可直接否決。門檻需依實際選稿結果調整。
7. AI 回傳 `decision`（寫稿／待補件／略過）、`category`、`reason`、`evidence`、`score`、`expiresAt` 與風險標記。日期判斷有疑義時進待補件。
8. 每週與每來源的篇數上限在建立產稿工作前檢查，使用同一筆來源的等待／執行工作去重。

以上是本專案的可審查政策建議，沒有平台統一規定的選稿分數或資料保留天數。AI 選稿通過後仍先建立待審草稿，發佈沿用人工核准流程。

## 寫稿與作圖政策建議

- 寫稿保留原文語意，區分「已發生的成果」與「未來預期」，每版自行完成資訊彙整與總結。
- 四版沿用同一組已確認事實，僅調整段落與表達。字數越界時修訂，資料不足時回報補件，避免用空泛口號湊字。
- 優先挑同一篇文章且與事件相關的圖片，避免直接把列表頁各篇新聞的縮圖都附進同一稿。
- 自動套版可用來源圖片或品牌色背景，分層加入短標題與摘要。缺圖時可先產生品牌文字卡，標記人工檢查。
- AI 配圖使用主題、物件、色彩與留白描述，生成無字底圖，文字由編輯器加入。概念插畫標記其性質，活動人物及場景應有實際依據。
- 付費 AI 生圖需由管理者主動啟用並設定預算。可將自動作圖模式設定為手動、品牌套版、AI 概念圖三種，先檢查規則再開啟。
- 自動圖卡與文章保存來源關聯、配圖描述、版面配方及生成結果，方便追查和重新編輯。

Meta 已提供 AI 揭露參數，Instagram 使用 `is_ai_generated`，Threads 使用 `is_made_with_ai`。若要自動送出該標籤，應在平台轉接器另外傳送，圖卡文字註記與平台參數各自處理。[Instagram AI Content](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md#ai-content) · [Threads AI label](https://developers.facebook.com/documentation/threads/posts.md#label-ai-generated-content)

## 時間與資料堆積的建議

來源掃描、AI 產稿、人工核准與發佈分別安排。可先用目前每 120 分鐘掃描來源，再設定承辦人容易審核的產稿時段。實際發佈時段應由各單位的讀者活動與成效決定。

資料時效與儲存保留分開設定。文章超過來源天數後移入過期／封存區，停止自動選稿。封存可保留 90 天作為可調整的起始政策，清除時保護仍被貼文、發佈紀錄或圖卡引用的資料。前端以分類、來源、狀態、日期區間及分頁顯示，預設聚焦待處理資料。

要比較發佈時段，可連續 4 週測試 2～3 個時段，盡量維持相近的類別、篇幅、圖片形式及頻率，分平台比較觸及、互動與連結點擊。Threads 與 Instagram 官方 Insights 提供相關指標，但各指標的權限及可用性不同，取得後再調整政策。[Threads Insights](https://developers.facebook.com/documentation/threads/insights.md) · [Instagram Insights](https://developers.facebook.com/documentation/instagram-platform/insights.md)

本次沒有取得單位的實際受眾 Insights，時段與分數屬可調整的起始建議。文章的有效期限與自動刪除期限應顯示在設定及素材詳情，讓承辦人能先檢查。

## 目前版本的實作對照

目前實作採全域每日與每週自動處理上限。AI 選稿回傳 eligible、score、category、reason、facts、expiresAt 與判斷時間。網址去重及新擷取相同原文檢查已加入，同一事件的跨來源語意去重與每來源獨立配額可作後續擴充。

素材預設在來源發布後 30 天停止自動選稿，來源日期缺失則採擷取日。擷取後 90 天進入封存區並持續保留，可手動還原。實際可儲存與啟用的規則見 [自動化規則檢查單](automation-policy.md)。
