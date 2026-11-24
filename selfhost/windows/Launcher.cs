using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("校園發聲")]
[assembly: AssemblyProduct("Campus Social")]

internal sealed class Launcher : Form
{
    private static readonly string Home = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string AppData = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CampusSocial");
    private readonly Panel content = new Panel();
    private readonly Label message = new Label();
    private readonly ToolStripLabel status = new ToolStripLabel("啟動中");
    private readonly ToolStripMenuItem settings = new ToolStripMenuItem("設定");
    private readonly ToolStripMenuItem account = new ToolStripMenuItem("管理員密碼");
    private readonly string profile;
    private Process service;
    private WorkspaceView workspace;
    private TaskCompletionSource<string> pendingAccountRequest;
    private bool configured;
    private bool stopping;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string id;
        using (var sha = SHA256.Create())
            id = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Home.ToUpperInvariant())));
        bool first;
        using (var instance = new Mutex(true, "Local\\CampusSocial-" + id, out first))
        {
            if (first)
            {
                AppDomain.CurrentDomain.AssemblyResolve += ResolveWebViewAssembly;
                Application.Run(new Launcher(Path.Combine(AppData, "profiles", id.Replace("-", ""))));
            }
            else MessageBox.Show("校園發聲已在此資料夾執行。請回到原本的工作台視窗。", "校園發聲");
        }
    }

    private Launcher(string profile)
    {
        this.profile = profile;
        Text = "校園發聲";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Font;
        Font = new Font("Microsoft JhengHei UI", 10);
        ClientSize = new Size(1280, 840);
        MinimumSize = new Size(760, 520);

        content.Dock = DockStyle.Fill;
        content.BackColor = Color.White;
        message.Text = "正在準備工作台…";
        message.TextAlign = ContentAlignment.MiddleCenter;
        message.Dock = DockStyle.Fill;
        message.Padding = new Padding(28);
        content.Controls.Add(message);
        Controls.Add(content);

        var toolbar = new MenuStrip
        {
            Dock = DockStyle.Top, Padding = new Padding(9, 2, 9, 2),
            Font = new Font("Microsoft JhengHei UI", 9),
        };
        settings.Alignment = ToolStripItemAlignment.Right;
        settings.DropDownItems.Add("程式設定", null, (sender, args) => OpenSettings());
        account.Enabled = false;
        account.Click += (sender, args) => OpenAccount();
        settings.DropDownItems.Add(account);
        toolbar.Items.Add(status);
        toolbar.Items.Add(settings);
        MainMenuStrip = toolbar;
        Controls.Add(toolbar);

        Shown += async (sender, args) => await StartService();
        FormClosing += (sender, args) =>
        {
            if (service == null) return;
            args.Cancel = true;
            if (stopping) return;
            stopping = true;
            settings.Enabled = false;
            account.Enabled = false;
            SetMessage("停止中", "正在停止，請等候執行中的工作完成…");
            RequestShutdown();
        };
    }

    private void SetMessage(string state, string detail)
    {
        status.Text = state;
        message.Text = detail;
        message.Visible = true;
        message.BringToFront();
    }

    private void RequestShutdown()
    {
        try { service.StandardInput.Close(); }
        catch (IOException) { }
    }

    private async Task StartService()
    {
        bool startupError = false;
        try
        {
            string runtime = await Task.Run(() => ExtractRuntime());
            if (IsDisposed) return;
            workspace = await WorkspaceView.AttachAsync(content, runtime, profile);
            if (IsDisposed) return;
            var info = new ProcessStartInfo(Path.Combine(runtime, "node.exe"),
                "--env-file-if-exists=.env.selfhost \"" + Path.Combine(runtime, "selfhost", "windows", "run.mjs") + "\"")
            {
                WorkingDirectory = Home,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true
            };
            service = Process.Start(info);
            string line;
            while ((line = await service.StandardOutput.ReadLineAsync()) != null)
            {
                if (stopping) continue;
                string[] fields = line.Split(' ');
                ushort port;
                if (fields.Length == 3 && fields[0] == "READY" && UInt16.TryParse(fields[1], out port))
                {
                    workspace.Navigate(new Uri("http://127.0.0.1:" + port + "/?desktop"));
                    message.Visible = false;
                    SetAccountStatus(fields[2] == "configured");
                }
                else if (line.StartsWith("ADMIN ", StringComparison.Ordinal) && pendingAccountRequest != null)
                {
                    var completed = pendingAccountRequest;
                    pendingAccountRequest = null;
                    completed.TrySetResult(line.Substring("ADMIN ".Length));
                }
                else if (fields[0] == "ERROR")
                {
                    startupError = true;
                    if (line == "ERROR PORT") SetMessage("啟動失敗", "PORT 必須是 1 到 65535 之間的整數。請修改設定檔後重新啟動。");
                    else if (fields.Length == 3 && fields[1] == "IN_USE")
                        SetMessage("啟動失敗", "連接埠 " + fields[2] + " 使用中。請停止正在使用它的服務，或修改設定檔中的 PORT。");
                    else SetMessage("啟動失敗", "請確認資料目錄可寫入、管理者信箱有效，且密碼至少 12 字元。");
                }
            }
            if (!stopping && !startupError)
                SetMessage("服務已停止", "請確認 .env.selfhost 設定及資料夾權限後重新啟動。");
        }
        catch (Exception error)
        {
            if (!IsDisposed && !stopping)
                SetMessage("啟動失敗", "請確認已安裝 Microsoft Edge WebView2 Runtime，且 EXE 所在資料夾和本機應用程式資料夾可寫入。\r\n" + error.GetType().Name);
        }
        if (service != null)
        {
            RequestShutdown();
            await Task.Run(() => service.WaitForExit());
            service.Dispose();
            service = null;
        }
        if (!IsDisposed)
        {
            account.Enabled = false;
            if (pendingAccountRequest != null) pendingAccountRequest.TrySetResult("ERROR");
            if (stopping) Close();
        }
    }

    private static string RuntimeDirectory()
    {
        return Path.Combine(AppData, "runtime", Assembly.GetExecutingAssembly().ManifestModule.ModuleVersionId.ToString("N"));
    }

    private static Assembly ResolveWebViewAssembly(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
        string library = Path.Combine(RuntimeDirectory(), "webview2", name + ".dll");
        return File.Exists(library) ? Assembly.LoadFrom(library) : null;
    }

    private static string ExtractRuntime()
    {
        var assembly = Assembly.GetExecutingAssembly();
        string runtime = RuntimeDirectory();
        if (Directory.Exists(runtime)) return runtime;

        string temporary = Path.Combine(Path.GetDirectoryName(runtime), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try
        {
            using (Stream payload = assembly.GetManifestResourceStream("runtime.zip"))
            using (var archive = new ZipArchive(payload, ZipArchiveMode.Read))
                archive.ExtractToDirectory(temporary);
            try { Directory.Move(temporary, runtime); }
            catch (IOException) { if (!Directory.Exists(runtime)) throw; }
            return runtime;
        }
        finally
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
        }
    }

    private void OpenSettings()
    {
        string file = Path.Combine(Home, ".env.selfhost");
        try
        {
            if (SettingsDialogs.EditStartupSettings(this, file))
                MessageBox.Show(this, "設定已儲存。重新開啟程式後生效。", "程式設定");
        }
        catch (IOException) { MessageBox.Show(this, "無法讀取設定檔。請確認資料夾權限。", Text); }
        catch (UnauthorizedAccessException) { MessageBox.Show(this, "無法讀取設定檔。請確認資料夾權限。", Text); }
    }

    private void OpenAccount()
    {
        if (SettingsDialogs.EditAdministrator(this, !configured, SaveAdministrator))
        {
            SetAccountStatus(true);
            workspace.OpenWorkspace();
        }
    }

    private void SetAccountStatus(bool hasAdministrator)
    {
        configured = hasAdministrator;
        account.Text = configured ? "變更管理員密碼" : "建立管理員";
        account.Enabled = true;
        status.Text = configured ? "工作台與排程運作中" : "尚未設定管理者，可探索示範工作台";
    }

    private async Task<string> SaveAdministrator(string identity, string password)
    {
        if (service == null || pendingAccountRequest != null) return "ERROR";
        var completion = new TaskCompletionSource<string>();
        pendingAccountRequest = completion;
        try
        {
            var serializer = new JavaScriptSerializer();
            string json = configured
                ? serializer.Serialize(new { current = identity, next = password })
                : serializer.Serialize(new { email = identity, password });
            var input = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
            await service.StandardInput.WriteLineAsync((configured ? "CHANGE " : "SETUP ") + input);
            await service.StandardInput.FlushAsync();
            string result = await completion.Task;
            string[] fields = result.Split(' ');
            if (fields[0] != "CREATED" && fields[0] != "CHANGED") return result;

            long expiresAt;
            if (fields.Length == 3 && Int64.TryParse(fields[2], out expiresAt))
            {
                try
                {
                    if (await workspace.InstallSessionAsync(fields[1], expiresAt)) return fields[0];
                }
                catch (COMException) { }
                catch (InvalidOperationException) { }
            }
            return "SIGN_IN_REQUIRED";
        }
        catch (IOException) { return "ERROR"; }
        catch (ObjectDisposedException) { return "ERROR"; }
        finally
        {
            if (pendingAccountRequest == completion) pendingAccountRequest = null;
        }
    }
}
