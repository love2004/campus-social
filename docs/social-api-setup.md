# 四平台 API 與發文憑證取得指南

2026-11-04 查核。適用目前這套私有自架系統。請由單位管理者在官方後台取得憑證，並直接填入工作台。

## 先確認要取得什麼

Meta 平台使用開發者 App、帳號權限與 Access Token。LINE 使用官方帳號及 Messaging API Channel。下表對照本系統的設定欄位。

| 平台 | 帳號條件／本版採用方式 | 要填入本系統「社群帳號」的欄位 |
| --- | --- | --- |
| Facebook | 粉絲專頁。授權者能管理內容 | `META_GRAPH_VERSION`、`FACEBOOK_PAGE_ID`、`FACEBOOK_PAGE_TOKEN` |
| Instagram | 專業帳號（商業或創作者），連結 Facebook 粉專。本版走 Facebook Login | `META_GRAPH_VERSION`、`INSTAGRAM_USER_ID`、同一組 `FACEBOOK_PAGE_TOKEN` |
| Threads | Threads 帳號，完成 Threads API 授權 | `THREADS_USER_ID`、`THREADS_TOKEN` |
| LINE | 官方帳號啟用 Messaging API。支援好友群發或指定群組 | `LINE_CHANNEL_TOKEN`、`LINE_GROUP_ID`（群組） |

目前網站採手動填入 Token。OAuth 授權、交換及續期在官方工具或受控主機操作。App ID 與 App Secret 用於授權和交換，工作台的 Token 欄填入交換完成的 Access Token。

## 1. Facebook 粉絲專頁

### 準備帳號與 App

1. 準備單位粉絲專頁，以及具備該專頁內容管理權限的 Facebook 帳號。一般個人動態時報不屬於本系統的粉專發文整合。
2. 到 [Meta 開發者後台](https://developers.facebook.com/apps/) 建立 App。官方 Pages API 的用途名稱是 **Manage everything on your Page**（管理粉絲專頁相關功能）。在用途設定加入需要的權限。
3. 粉專列舉及貼文發佈的核心權限為 `pages_show_list`、`pages_read_engagement`、`pages_manage_posts`。該用途還預設加入 `business_management`、`public_profile`。依後台用途保留必需項目。若使用額外功能，或後台顯示其他相依權限，依相應端點文件補齊，不要把留言、洞察、廣告權限一律視為發文必需。

對應官方文件 [建立 Pages API App](https://developers.facebook.com/documentation/pages-api/create-an-app.md)、[Pages API 入門](https://developers.facebook.com/documentation/pages-api/getting-started.md)、[貼文與圖片發佈](https://developers.facebook.com/documentation/pages-api/posts.md)。Meta 入門頁部分權限名稱與其他頁面不一致時，以開發者後台及權限參照提供的實際權限為準。本指南使用 `pages_read_engagement`。

### 取得 Page ID 與 Page Token

1. 開啟 [Graph API Explorer](https://developers.facebook.com/tools/explorer/)，選擇自己剛建立的 App 及後台支援的 Graph API 版本。查核時官方文件範例使用 `v26.0`。本系統版本欄位要含前面的 `v`。
2. 取得 **User Access Token**，選擇上述權限，登入具備粉專權限的帳號，並在授權畫面勾選正確的單位粉專。若也要設定 Instagram，將下一節的 Instagram 權限一起加入。
3. 以該 User Token 執行以下唯讀查詢：

   ```text
   GET /me/accounts?fields=id,name,access_token,tasks
   ```

4. 在結果 `data` 找到正確的粉專：`id` 是 `FACEBOOK_PAGE_ID`。該筆物件的 `access_token` 是該粉專的 `FACEBOOK_PAGE_TOKEN`。使用這筆粉專資料回傳的 Token。

對應官方文件 [Pages API 運作與授權](https://developers.facebook.com/documentation/pages-api/overview.md)、[取得 Page ID 與 Token](https://developers.facebook.com/documentation/pages-api/getting-started.md)。

### 常駐主機的長效 Page Token

短效 Token 適合初次測試。官方長效流程為：

1. 用有效的短效 User Token、App ID、App Secret，在受保護的伺服器端呼叫 `GET /oauth/access_token`，參數為 `grant_type=fb_exchange_token`、`client_id`、`client_secret`、`fb_exchange_token`，換取長效 User Token。
2. 使用換到的長效 User Token，再呼叫 `/me/accounts`，重新取得目標粉專的 Page Token。
3. 將新 Page Token 填入系統。用 [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) 檢查權限與效期。

長效 User Token 通常約 60 天。由它取得的長效 Page Token 沒有固定到期日，但仍可能因撤銷授權、帳號／資產權限或安全狀態變更而失效。Token 交換需要 App Secret，應在伺服器端進行，避免放在前端程式或共享紀錄中。[官方長效 Token 流程](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived.md)

## 2. Instagram

### 使用與本版相符的授權方式

目前程式呼叫 `graph.facebook.com`，並使用 Facebook Page Token。請採用 **Instagram API with Facebook Login**：

1. 將 Instagram 轉成專業帳號（Business 或 Creator）。
2. 將該帳號連結到準備好的 Facebook 粉絲專頁，並確認授權者具備該粉專的內容管理權限。
3. 在 Meta App 的對應用途／權限設定中加入 `instagram_basic`、`instagram_content_publish`。並包含用來找粉專及讀取關聯的 `pages_show_list`、`pages_read_engagement`。
4. 重新授權，選中正確的粉專與 Instagram 帳號，再取得包含這些權限的 Page Token。先前只授權 Facebook 發文的 Token，不會因為新增設定就自動獲得 Instagram 權限。

官方另提供 Instagram Login 及 Unified Login。它們的權限、Token 與帳號前提不同。設定本版時請沿用上面的 Facebook Login 流程。[官方三種整合方式比較](https://developers.facebook.com/documentation/instagram-platform/overview.md)、[Facebook Login 版入門](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md)

### 取得 Instagram User ID

使用已授權的 Token，在 Graph API Explorer 執行：

```text
GET /你的_FACEBOOK_PAGE_ID?fields=instagram_business_account
```

回傳格式範例（數字僅為占位）：

```json
{
  "instagram_business_account": { "id": "INSTAGRAM_ACCOUNT_ID" },
  "id": "FACEBOOK_PAGE_ID"
}
```

把 `instagram_business_account.id` 填入 **`INSTAGRAM_USER_ID`**。填寫內層的數字帳號 ID。[官方取得 IG 帳號 ID 步驟](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md)

### 權限與帳號常見問題

- 未回傳 `instagram_business_account`：先核對專業帳號狀態、粉專連結、授權勾選的資產及管理者權限。
- 若使用者的粉專角色是經由 Business Manager 授予，官方發佈文件還列出該情境下的 `ads_management`、`ads_read` 額外要求。遇到權限錯誤時依實際帳號情境核對，勿只確認 Token 字串存在。
- 若粉專被要求完成 Page Publishing Authorization，必須先完成才能透過相關 Instagram 發佈功能送出。
- Instagram 圖片發佈需讓平台讀取公開圖片 URL。本版會產生 JPEG。單純本機 `127.0.0.1` 圖片網址無法供平台讀取。

對應官方文件 [Instagram 發佈需求與公開圖片 URL](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)。

## 3. Threads

需要取得 `THREADS_USER_ID` 與 **Threads 使用者 Access Token** `THREADS_TOKEN`。

1. 進入 [Meta App Dashboard](https://developers.facebook.com/apps/)，建立含 **Access the Threads API** use case 的 App。到 use case 自訂頁加入 `threads_basic`、`threads_content_publish`。只做圖文發佈不需另外申請留言或洞察權限。[官方建置說明](https://developers.facebook.com/documentation/threads/get-started/create-an-app.md)
2. 在 App roles → Roles → Add People，加入單位帳號為 **Threads Tester**。帳號本人登入 Threads，於 Account Settings → Website permissions 接受邀請。角色內帳號可先測試。讓沒有 App 角色的其他單位授權，則需對應權限通過 App Review 並發佈 App。[官方入門](https://developers.facebook.com/documentation/threads/get-started.md)
3. 到 Threads use case Settings 取得 **Threads App ID／Threads App Secret**，並設定 OAuth redirect URI。這組可能不同於一般 Meta App ID／Secret，不能混用。[官方設定說明](https://developers.facebook.com/documentation/development/create-an-app/threads-use-case)
4. 官方 Profiles 文件指出，測試可透過 [Graph API Explorer](https://developers.facebook.com/tools/explorer/) 產生 Token 並授權。若 Explorer 沒有可用的 Threads 流程，使用下列官方 OAuth 步驟，或由管理者依 [Meta 官方示範程式](https://github.com/fbsamples/threads_api) 完成一次授權。以帳號後台實際提供的授權入口為準。[Profiles 文件](https://developers.facebook.com/documentation/threads/threads-profiles.md)
5. OAuth 授權網址為 `https://threads.com/oauth/authorize`，參數包括 `client_id`、`redirect_uri`、`scope=threads_basic,threads_content_publish`、`response_type=code`。實作時加入隨機 `state` 並驗證。redirect URI 必須和後台完全一致。成功後收到一次性 `code`。[官方授權流程](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions.md)
6. 在受控伺服器將 code 送到 `POST https://graph.threads.com/oauth/access_token`，表單參數是 `client_id`、`client_secret`、`grant_type=authorization_code`、`redirect_uri`、`code`。回傳 `access_token` 與 `user_id`。[官方 Token 交換](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions.md)
7. 把尚未過期的短期 Token 換成長期 Token，伺服器呼叫：

   ```text
   GET https://graph.threads.com/access_token
   grant_type=th_exchange_token
   client_secret=<THREADS_APP_SECRET>
   access_token=<SHORT_LIVED_TOKEN>
   ```

   短期 Token 約一小時。長期 Token 有效 60 天。含 Secret 的交換只應在伺服器執行。[官方長期 Token 文件](https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens.md)
8. `THREADS_USER_ID` 填第 6 步回傳的 `user_id`。也可帶該 Token 查詢 `GET https://graph.threads.com/v1.0/me?fields=id,username`，核對帳號。`THREADS_TOKEN` 填第 7 步回傳的長期 `access_token`。[官方個人檔案查詢](https://developers.facebook.com/documentation/threads/threads-profiles.md)
9. 續期使用 `GET https://graph.threads.com/refresh_access_token`，帶 `grant_type=th_refresh_token`、`access_token=<LONG_LIVED_TOKEN>`。Token 須建立至少 24 小時、仍未過期且有 `threads_basic`，更新後有效期再延長 60 天。過期則須重新授權。[官方續期規則](https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens.md)

OAuth 流程需要另外準備能接收授權碼的 redirect URI。工作台目前接受已取得的 Token，續期後請手動更新。

## 4. LINE 官方帳號

將 Channel Access Token 填入 `LINE_CHANNEL_TOKEN`。未設定群組時，工作台會發送給該官方帳號的好友。設定 `LINE_GROUP_ID` 後，工作台會改為推送至該群組。 [LINE 傳訊方式](https://developers.line.biz/en/docs/messaging-api/sending-messages/)

1. 用單位管理帳號登入 [LINE Official Account Manager](https://manager.line.biz/)，選擇現有官方帳號。沒有的話先建立官方帳號。[官方入門](https://developers.line.biz/en/docs/messaging-api/getting-started/)
2. 在官方帳號的設定中找到 **Messaging API** 並啟用，依畫面完成開發者資料及 Provider 選擇。Provider 應由單位持有。綁定後不能移除或改綁，應先確認歸屬。[官方啟用流程](https://developers.line.biz/en/docs/messaging-api/getting-started/)
3. 啟用後會自動建立 Messaging API Channel。現在不能直接在 Developers Console 新建這種 Channel，應從第 2 步開始。[官方入門與停用舊建置入口說明](https://developers.line.biz/en/docs/messaging-api/getting-started/)
4. 用同一個帳號登入 [LINE Developers Console](https://developers.line.biz/console/)，依序選 Provider → 剛建立的 **Messaging API Channel** → **Messaging API** 分頁。[官方 Channel 設定流程](https://developers.line.biz/en/docs/messaging-api/getting-started/)
5. 找到 **Channel access token (long-lived)**，尚未發行時按 **Issue／發行**，複製取得的 Token，填入本系統 `LINE_CHANNEL_TOKEN`。長期 Token 沒有固定到期日。重新發行會使舊 Token 失效，可設定最長 24 小時的交接時間，並同步更新系統。[官方 Token 類型與發行位置](https://developers.line.biz/en/docs/basics/channel-access-token/#long-lived-channel-access-token)
6. 以本版的手動設定流程，填入前一步發行的 Messaging API Token。[官方 Token 說明](https://developers.line.biz/en/docs/basics/channel-access-token/)
7. 回系統「社群帳號 → LINE」儲存並檢查連線。好友模式會查詢帳號資料。測試好友群發時可使用獨立測試官方帳號。 [LINE Messaging API](https://developers.line.biz/en/reference/messaging-api/nojs/)

### 發送到指定 LINE 群組

1. 在 LINE Developers 的 Messaging API 設定啟用「允許機器人加入群組」。[LINE 群組設定](https://developers.line.biz/en/docs/messaging-api/group-chats/)
2. 若已知群組 ID，直接填入「LINE 群組 ID」。若需要接收群組 ID，在工作台儲存同一頻道的 Channel secret，並在 LINE Developers 啟用 webhook，網址設定為公開 HTTPS 工作台網址加上 `/api/line/webhook`。
3. 邀請官方帳號加入測試群組。若帳號已在群組內，傳一則群組訊息。接著按「帶入最近收到的群組 ID」並儲存。系統只保留群組 ID，不保存收到的訊息內容。
4. 按「檢查帳號連線」核對群組名稱。貼文勾選 LINE 並核准後，即可照既有流程發佈或排程。每個工作台同時可設定一個目的群組。目的地變更時，舊貼文需重新審核。圖卡仍需可供 LINE 讀取的公開 HTTPS 圖片網址。

Webhook 用於接收加入好友、傳訊等事件。這套主動群發流程可直接使用 Channel Access Token。[官方 Webhook 說明](https://developers.line.biz/en/docs/messaging-api/building-bot/)

Messaging API 群發計入官方帳號方案的月訊息量，依接收人數計算。超過可發送上限會失敗。免費額度、月費與加購條件依台灣現行方案，請在官方帳號後台確認。[官方計費方式](https://developers.line.biz/en/docs/messaging-api/pricing/)、[台灣方案入口](https://tw.linebiz.com/)

## 設定與驗收

1. 在本系統開啟「社群帳號」，依上表填入憑證並儲存。Facebook 與 Instagram 共用版本與 Page Token，因此更新這兩個欄位會影響兩個平台。
2. 按各平台的「檢查帳號連線」，核對回傳帳號名稱是否是預期的單位帳號。這一步使用唯讀查詢，可在本機測試站執行。
3. 發佈權限需用實際貼文驗收。圖片發佈前，請在部署主機設定可由平台讀取的公開 HTTPS 網址 `PUBLIC_BASE_URL`。連線檢查成功只代表帳號資料可讀取。LINE 群發的對象是該官方帳號的好友，正式帳號發佈前先確認對象與訊息額度。
4. 把 Threads 的效期記錄在維運資料中，在到期前續期並更新系統。重新授權 Facebook 或重發 LINE Token 後，也要重新檢查連線。

本版欄位、唯讀檢查與圖片網址限制見 [平台實作](../selfhost/publish.mjs)，主機設定見 [自架部署指南](selfhost-deployment.md)。

## 社群分析儀表板

登入後選擇「社群分析」。近 7、30、90 天以台北時間及平台送出時間計算，含今天；「較前一期」是與前一段相同天數的送出筆數差。總覽查詢帳號人數；選擇單一平台後，另查詢期間內最近 20 筆工作台送出紀錄的成效。顯示的是每篇截至當次查詢的累計數值。若某項平均只取得部分貼文的數字，畫面會標示有效篇數。

| 平台 | 成效與憑證 |
| --- | --- |
| Facebook | 觀看、觸及、表情反應加留言。洞察需 `read_insights`、`pages_read_engagement` 與粉專的 ANALYZE 工作權限，重新授權後更新 `FACEBOOK_PAGE_TOKEN`。[Pages Insights](https://developers.facebook.com/docs/graph-api/reference/insights/) |
| Instagram | 觀看、觸及、總互動。Facebook Login 授權需包含 `instagram_manage_insights`、`instagram_basic` 與 `pages_read_engagement`。建議在 Instagram 卡片填入已授權的 Facebook User Access Token（`INSTAGRAM_INSIGHTS_TOKEN`），空白時會嘗試沿用 `FACEBOOK_PAGE_TOKEN`；發文仍使用原有 Page Token。[Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) |
| Threads | 觀看與喜歡、回覆、轉貼、引用的總和。加入 `threads_manage_insights`，重新授權後更新 `THREADS_TOKEN`。[Threads API](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) |
| LINE | 用既有 Channel Access Token 讀取好友數和每次群發的送達、開啟、點擊。好友數採 LINE 的日本時區；開啟或點擊未結算或低於隱私門檻時可能無數字。[LINE Messaging API](https://developers.line.biz/en/reference/messaging-api/#get-user-interaction-statistics) |

開啟「社群分析」後，請逐一選擇四個平台，核對帳號規模與一筆有平台識別碼的歷史貼文。舊紀錄若只有容器識別碼、人工確認而無貼文 ID，或 LINE 缺少官方 Request ID，仍會計入送出筆數，但不能查單篇成效。系統以「—」顯示無法取得的指標，API 真正回傳的 0 則顯示為 0。畫面會短暫沿用查詢結果：Meta 通常 5 分鐘，LINE 30 分鐘。

發佈結果待核對時，可在「發佈紀錄」補錄平台實際送出時間與貼文 ID 或 LINE Request ID。日期留白時，報表會以原始送出嘗試或排程時間估算，並在表格標示。帳號卡片的筆數只計目前帳號，換綁前或未保存帳號的紀錄另外計數，仍可在期間總覽看到。

更換發佈帳號後，待審與已核准稿件可核對新目的地並重新核准。已有發佈工作的稿件可複製成新草稿，原工作保留供核對。LINE 更換 Token 前後都按「檢查帳號連線」，系統會使用同一個官方帳號的識別碼辨認續期。

首次啟動此版時，尚未結案的舊工作會依當時設定的帳號建立綁定。若要同時升級與換綁帳號，先以原有設定完成升級，再換綁。

## Meta App 角色與審查

單位自行管理自己的 App 與社群資產時，可先用具有 App 角色及資產權限的帳號測試，並依後台所示 Access Level 驗收。若由同一個 App 提供其他單位授權，或授權者沒有對應角色，須依 Meta 平台與權限要求申請 Advanced Access、App Review 及 Business Verification，並依用途完成 App 發佈。[Pages API 角色與審查](https://developers.facebook.com/documentation/pages-api/overview.md)、[Instagram 存取級別](https://developers.facebook.com/documentation/instagram-platform/overview.md)、[Threads 測試者與審查](https://developers.facebook.com/documentation/threads/get-started.md)
