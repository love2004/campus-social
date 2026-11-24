# 校園發聲專案報告規劃草稿

**建議讀者**　校方主管、社群承辦人與資訊工程評審。正式稿建議以前後各約四頁為目標。前半以校園活動公告說明讀者與承辦人的需求，後半沿用同一案例，說明系統如何保留來源、核對稿件、安排發文及處理異常。

## 前半部　專案價值

### 1. 校園公告從發布到被讀懂

一份活動簡章通常要經過摘錄、改寫、做圖與排程，才能成為 Facebook 粉絲專頁、Instagram、Threads 或 LINE 官方帳號上的貼文。四個平台的版面與閱讀習慣不同，活動日期、地點和報名方式卻必須一致。校園發聲把這些工作集中到一個工作台，讓承辦人掌握各版內容，也讓學生和家長更容易找到參加活動所需的資訊。 [第一版需求](requirements.md)

### 2. 用修理工作坊走一遍承辦流程

以虛構的校園修理工作坊為例。承辦人建立主題，匯入簡章和照片，系統依素材產出各平台文案。正式稿可以並列 Facebook 與 LINE 的示意稿。Facebook 用一段話說明親子會動手練習什麼，LINE 把日期、地點與報名連結放在容易掃讀的位置。圖卡提供活動名稱和重點，貼文文字保留完整的參加資訊。承辦人在工作台核對來源與圖片，選擇要發的管道並確認時段。 [主題日曆規格](v1-topic-publishing-spec.md) · [修理工作坊試讀情境](v1-blind-reading-rubric.md)

### 3. 承辦人如何掌握內容與發文節奏

一般稿由承辦人編輯、核准後交給常駐主機排程。單位可另外啟用主題自動發文，讓符合審核與排程條件的主題稿到點送出。承辦人仍可檢視、修改或鎖定主題稿。平日時段可由有效備稿補位，有發佈異常時可回到工作台查閱個別平台結果。發佈後，社群分析可協助回顧近 7、30、90 天的發文節奏，並在平台授權與資料可用的情況下查看帳號及貼文成效。 [工作流程](system-workflow-and-technology.md) · [主題日曆規格](v1-topic-publishing-spec.md) · [社群分析報表](../selfhost/analytics-report.mjs)

### 4. 用讀者試讀檢查內容品質

正式稿可沿用既有匿名試讀設計。以相同素材準備現行流程稿與系統稿，請目標讀者讀完後回答「活動在做什麼」「何時、何地舉行」「如何報名」。承辦人另行核對日期、地點、來源和單位語氣，判定各稿是否可發佈。減少重複整理是預期效益，現有試讀規劃以讀者理解與稿件品質為主要驗收項目。 [讀者問卷](v1-blind-reading-participant.md) · [主持與評分表](v1-blind-reading-rubric.md)

## 後半部　資訊工程技術

### 5. 系統架構與部署方式

以目前自架版為主。React、TypeScript 與 Vite 提供工作台，Node.js HTTP 服務處理登入、資料驗證與操作請求。SQLite 保存素材資料、稿件版本、時段和發佈工作，圖片檔案另存於主機。背景工作引擎從資料庫領取工作，執行來源整理、AI 產稿、發佈與郵件寄送。Linux 常駐部署使用 Docker Compose，可透過 Caddy 提供 HTTPS。Windows 桌面啟動器使用 WebView2 顯示工作台。 [工作台](../selfhost/web/main.tsx) · [HTTP 服務](../selfhost/server.mjs) · [資料庫](../selfhost/store.mjs) · [部署指南](selfhost-deployment.md) · [Windows 啟動方式](../README.md#windows-一鍵啟動)

#### 圖 1　自架系統架構與資料流

```mermaid
flowchart TB
    subgraph ENTRY["使用者介面與部署入口"]
        Browser["瀏覽器中的 React 工作台<br/>TypeScript 編寫、Vite 建置"]
        Caddy["Linux Docker Compose<br/>選用 Caddy HTTPS 反向代理"]
        Desktop["Windows CampusSocial.exe<br/>啟動本機 Node.js 與 WebView2 工作台"]
        Browser -->|HTTPS| Caddy
    end

    subgraph HOST["自架主機上的應用程式"]
        API["Node.js HTTP 與 JSON API<br/>登入、工作階段、Zod 驗證與版本檢查"]
        Engine["背景工作引擎<br/>預設每 15 秒檢查，依 SQLite 租約領取工作"]
        Gather["來源整理<br/>定期掃描網站與 RSS、去重與篩選"]
        Draft["AI 產稿<br/>一般與主題工作、來源留存、審稿與階段進度"]
        Publish["週期排程與平台轉接器<br/>選稿、派工、送出與結果更新"]
        Mail["郵件工作<br/>Nodemailer 寄出待審摘要與異常通知"]
        Media["媒體模組<br/>Sharp 處理圖片、圖卡與平台尺寸副本"]
        Analytics["社群分析<br/>發佈趨勢、帳號與貼文指標"]
        CLI["主機 Codex CLI<br/>Web Search、結構化產稿與選用生圖"]
        API -->|匯入圖片、預覽、匯出| Media
        API -->|讀取報表| Analytics
        Engine --> Gather & Draft & Publish & Mail
        Gather --> CLI
        Draft -->|使用主機訂閱時| CLI
        Draft -->|依圖卡設定套版| Media
        Publish -->|取得發佈用圖片| Media
        Media -->|選用 Codex 生圖| CLI
    end

    subgraph DATA["主機持久化資料與備份"]
        SQLite[("SQLite 與 WAL<br/>來源、素材、主題、稿件、核准版本<br/>時段、分平台工作、租約、待寄郵件與加密憑證")]
        Files[("檔案目錄<br/>私人圖片、公開平台副本與主機金鑰")]
        Backup["備份工具<br/>SQLite 快照、圖片目錄與主機金鑰"]
        SQLite --> Backup
        Files --> Backup
    end

    subgraph EXTERNAL["外部服務"]
        Web["公開文章、網站與 RSS"]
        AIAPI["選用付費 OpenAI API<br/>文字或圖像生成"]
        Social["Facebook、Instagram、Threads、LINE<br/>發佈 API 與社群指標"]
        SMTP["單位 SMTP 服務"]
    end

    Caddy -->|轉送工作台與 API 請求| API
    Desktop -->|本機 HTTP 127.0.0.1| API
    API <-->|讀寫工作台資料與工作佇列| SQLite
    Engine <-->|領取工作並保存進度及結果| SQLite
    Analytics -->|讀取本機發佈紀錄| SQLite
    Media -->|保存圖片資訊及可重編輯版面| SQLite
    Media <-->|讀寫圖片檔案| Files
    API -->|按路由提供公開媒體副本| Files
    CLI -->|讀取公開來源| Web
    Draft -->|選用文字 API| AIAPI
    Media -->|選用 Images API| AIAPI
    Publish -->|按平台提交發佈請求| Social
    Analytics -->|依平台授權讀取成效| Social
    Social -.->|需要時透過 HTTPS 讀取圖片副本| Caddy
    Mail -->|寄出郵件| SMTP
```

背景引擎可與 HTTP 服務一起啟動，也可在同一主機另開工作程序。兩種方式皆使用 SQLite 租約協調同類工作。工作台保存的服務憑證以 AES-256-GCM 加密，解密所需的主機金鑰隨備份工具保存。 [引擎](../selfhost/engine.mjs) · [獨立工作程序](../selfhost/worker.mjs) · [資料儲存](../selfhost/store.mjs) · [備份工具](../selfhost/backup.mjs)

### 6. 公開來源、AI 審稿與圖卡輸出

系統可接收貼上的原文、文章網址或網站訂閱。公開網頁由主機的 Codex Web Search 取得，保留網址與可供核對的片段。自動選稿先依關鍵字、時效與篇數限制篩選。產稿輸出以 JSON Schema 和 Zod 驗證。主題稿依序保存來源、規劃、搜尋、產稿與審稿結果，重啟後可從已保存的階段接續。審稿與產稿分開執行，後端再確認引用能對回保存的證據。若工作坊簡章與補充來源的日期有衝突，稿件應留給承辦人確認。圖卡則保存原圖和版面設定，由 Sharp 匯出發佈用圖片。 [來源擷取](../selfhost/codex-web.mjs) · [產稿驗證](../selfhost/ai.mjs) · [主題稿流程](../selfhost/topic-drafts.mjs) · [圖卡輸出](../selfhost/media.mjs)

#### 圖 2　從素材匯入到稿件核准

```mermaid
flowchart TB
    Manual["承辦人貼上原文、匯入文章網址與照片"]
    Subscription["主機按設定間隔掃描網站與 RSS"]
    Materials[("素材庫<br/>原文或引文、網址、日期、分類與圖片候選")]
    Manual --> Materials
    Subscription -->|Codex Web Search、網址去重與擷取檢查| Materials

    subgraph GENERAL["一般稿"]
        Rules{"自動選稿符合關鍵字、時效與篇數上限？"}
        Semantic{"有無啟用 AI 語意選稿？"}
        Assess["評估相關性、可核對事實與活動期限"]
        Skip["保留素材或選稿原因"]
        Copy["產生四版文案及圖卡標題與摘要"]
        CopyCheck{"結構與正文篇幅有效？"}
        Revise["篇幅不符時使用同一服務修訂一次<br/>驗證仍失敗則記錄原因"]
        Art["匯入候選圖片，依設定套版或留待手動編修"]
        Rules -->|通過| Semantic
        Rules -->|未通過| Skip
        Semantic -->|有| Assess
        Semantic -->|無| Copy
        Assess -->|合格| Copy
        Assess -->|未達門檻| Skip
        Copy --> CopyCheck
        CopyCheck -->|通過| Art
        CopyCheck -->|未通過| Revise
        Revise -->|修訂後通過驗證| Art
    end

    subgraph TOPIC["主題稿"]
        Calendar["日曆建立主題、日期區間與素材關聯"]
        Plan["保存素材快照，由 AI 規劃目的、切入點與候選時段"]
        Research["視設定與需要補查公開資料<br/>保存實際來源，資料不足時沿用可用素材"]
        Candidate["產出四版文案及圖卡內容<br/>以 JSON Schema 與 Zod 驗證"]
        Evidence{"兩次獨立審稿及程式引文核對"}
        Rewrite["依審核理由重寫一次"]
        TopicArt["依設定準備圖卡或沿用已附圖片"]
        Auto{"已啟用自動發文<br/>且有可用時段與平台？"}
        Bind["記錄 AI 核准、內容雜湊及發佈帳號<br/>綁定主題時段"]
        Calendar --> Plan --> Research --> Candidate --> Evidence
        Evidence -->|首次要求修訂| Rewrite --> Candidate
        Evidence -->|通過| TopicArt --> Auto
        Auto -->|是| Bind
    end

    Materials -->|自動選稿| Rules
    Materials -->|人工指定可用素材產稿| Copy
    Materials -->|加入主題| Calendar

    Review["待承辦人核對文案、來源、圖序、平台與期限"]
    Human["人工核准，保存內容雜湊及發佈帳號"]
    Ready[("已核准稿件<br/>指定稿依綁定時段，其餘依佇列等候")]
    Art --> Review
    Auto -->|否| Review
    Evidence -->|關鍵事實衝突或修訂後仍未通過| Review
    Review -->|承辦人確認可發佈| Human --> Ready
    Bind --> Ready
    Ready -.->|修改核准涵蓋的內容時撤回核准| Review
```

主題產稿每個階段都保存進度與版本，重啟可接續最後已保存的階段。換稿最晚須在發文前 24 小時開始，候選版通過審核後才取代原稿。到了發文時間，候選版仍在處理時，系統保留仍有效的原稿。關鍵素材修正時，受影響的稿件會暫停發佈並重新核對。 [主題日曆規格](v1-topic-publishing-spec.md) · [自動選稿規則](automation-policy.md) · [產稿與換稿實作](../selfhost/topic-drafts.mjs)

### 7. 核准版本、發文佇列與異常復原

版本號用來攔截多視窗的過期修改。內容雜湊則將核准與當時的文案、圖片順序、平台和來源等欄位綁定，送出前再次核對。背景引擎依台北時區領取時段，優先採用仍有效的指定稿，其次為一般核准稿，再其次為有效備稿。SQLite 交易建立時段和各平台工作，並以每篇稿件與平台的組合限制重複建立。外部平台可能已收件，但主機在記錄結果前中斷。這類工作會標為結果不明，由承辦人查證，確認未發出後才能補送。 [核准與選稿規則](../selfhost/core.mjs) · [資料表約束](../selfhost/store.mjs) · [背景發佈引擎](../selfhost/engine.mjs)

#### 圖 3　從排程選稿到四平台發佈與復原

```mermaid
flowchart TB
    Tick["背景引擎輪詢<br/>依台北時區找出已到且尚未處理的時段"]
    Window{"還在允許的補送期限？"}
    Missed["記錄時段已錯過"]
    Bound{"有符合核准與時段條件的指定稿？"}
    Normal{"有仍有效的一般核准稿？"}
    Backup{"有仍有效的已核准備稿？"}
    Pick["選定稿件與可發佈的平台"]
    Skipped["記錄略過並排入通知"]
    Queue[("同一 SQLite 交易建立時段與各平台工作<br/>每篇稿件與平台的組合具唯一約束")]
    Guard{"送出前檢查<br/>核准雜湊、稿件版本、綁定、目的地、期限與平台格式"}
    Stop["停止該平台的舊工作或記錄失敗原因"]
    Prepare["準備所選平台的圖片與請求<br/>需要時製作公開 HTTPS 副本"]
    Sending["確認版本與時段仍有效<br/>以短交易記錄即將送出，外部請求在交易外執行"]

    Tick --> Window
    Window -->|否| Missed
    Window -->|是| Bound
    Bound -->|有| Pick
    Bound -->|無| Normal
    Normal -->|有| Pick
    Normal -->|無| Backup
    Backup -->|有| Pick
    Backup -->|無| Skipped
    Pick --> Queue --> Guard
    Guard -->|檢查未通過| Stop
    Guard -->|通過| Prepare --> Sending
    Sending -->|版本或時段已變更| Stop

    subgraph PLATFORMS["四平台各自執行並保存進度"]
        FB["Facebook 粉專<br/>文字或單圖直送，多圖先建立附件"]
        IG["Instagram<br/>建立圖片或輪播容器，等待就緒後發佈"]
        TH["Threads<br/>建立文字、圖片或輪播容器後發佈"]
        LINE["LINE 官方帳號<br/>好友群發或推播指定群組，使用固定重試鍵"]
    end

    Sending -->|送到所選平台| PLATFORMS
    PLATFORMS --> Result{"保存各平台結果及可取得的外部識別碼"}
    Result -->|平台確認發佈或接受請求| Sent["記錄已送出"]
    Result -->|確認失敗| Failed["記錄失敗原因並通知"]
    Result -->|送出後斷線或回應不確定| Unknown["記錄結果不明並通知承辦人"]
    Restart["主機重啟並回收過期的工作租約"] -->|尚在佇列的工作可繼續處理| Guard
    Restart -->|先前已進入送出階段但未記到結果| Unknown
    Unknown --> Confirm{"人工查看平台實際紀錄"}
    Confirm -->|確認已發出| Sent
    Confirm -->|確認未發出| Failed
    Failed -.->|原因已處理且稿件仍有效時，只補送該平台| Guard
    Sent --> History["更新時段與貼文總狀態<br/>工作台保留各平台的個別結果"]
    Failed --> History
    Unknown --> History
    Stop --> History
```

例如工作坊貼文已在 Facebook 發出，但 LINE 的請求逾時，工作台會保留 Facebook 的成功紀錄，並把 LINE 標為結果不明。承辦人確認 LINE 沒有發出後，才可對該平台提出補送。LINE 回應接受請求時，系統記錄的是 API 接受結果。 [平台轉接器](../selfhost/publish.mjs) · [發佈與人工核對 API](../selfhost/server.mjs)

### 8. 驗證結果與正式部署條件

**本機自架測試。** 2026-11-25 執行 `npm run selfhost:test`，75 項全數通過。正式稿可選改期後攔截舊稿、主機重啟接續工作、平台部分成功與結果不明三個案例，寫出各自的預期行為。 [自架測試](../selfhost/tests/)

**外部平台與 AI 紀錄。** 2026-11-15 已驗證 Facebook 測試專頁的純文字排程發文與公開可見性。修理工作坊的既有驗收另有真實 Codex 產稿，並用模擬 LINE 端點驗證到點送出及再次執行時沒有重送。 [驗證紀錄](validation.md)

**正式環境。** 指定 Linux 主機、正式網域與 HTTPS，以及單位持有的四平台帳號、圖片發佈與 SMTP 信件，仍以目標部署環境的實際驗收為準。 [部署與驗收指南](selfhost-deployment.md)
