using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class WorkspaceView
{
    private readonly WebView2 view;
    private Uri address;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string fileName, IntPtr reserved, uint flags);

    private WorkspaceView(WebView2 view)
    {
        this.view = view;
    }

    public static async Task<WorkspaceView> AttachAsync(Control host, string runtime, string profile)
    {
        const uint searchDllDirectoryAndSystem32 = 0x00001100;
        string loader = Path.Combine(runtime, "webview2", "WebView2Loader.dll");
        if (LoadLibraryEx(loader, IntPtr.Zero, searchDllDirectoryAndSystem32) == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        var view = new WebView2 { Dock = DockStyle.Fill };
        host.Controls.Add(view);
        view.SendToBack();
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
        if (view.IsDisposed) throw new ObjectDisposedException("WebView2");
        await view.EnsureCoreWebView2Async(environment);

        var workspace = new WorkspaceView(view);
        view.CoreWebView2.Settings.IsWebMessageEnabled = false;
        view.CoreWebView2.NavigationStarting += (sender, args) =>
        {
            Uri destination;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out destination) || !workspace.IsWorkspace(destination))
            {
                args.Cancel = true;
                if (args.IsUserInitiated) OpenExternal(destination);
            }
        };
        view.CoreWebView2.NewWindowRequested += (sender, args) =>
        {
            args.Handled = true;
            Uri destination;
            if (!args.IsUserInitiated || !Uri.TryCreate(args.Uri, UriKind.Absolute, out destination)) return;
            if (workspace.IsWorkspace(destination)) view.CoreWebView2.Navigate(destination.AbsoluteUri);
            else OpenExternal(destination);
        };
        return workspace;
    }

    public void Navigate(Uri target)
    {
        address = target;
        OpenWorkspace();
    }

    public void OpenWorkspace()
    {
        view.CoreWebView2.Navigate(address.AbsoluteUri);
    }

    public async Task<bool> InstallSessionAsync(string token, long expiresAt)
    {
        var manager = view.CoreWebView2.CookieManager;
        var cookie = manager.CreateCookie("campus_session", token, address.Host, "/");
        cookie.IsHttpOnly = true;
        cookie.SameSite = CoreWebView2CookieSameSiteKind.Strict;
        cookie.Expires = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(expiresAt);
        manager.AddOrUpdateCookie(cookie);
        var cookies = await manager.GetCookiesAsync(address.AbsoluteUri);
        return cookies.Any(item => item.Name == cookie.Name && item.Value == token);
    }

    private bool IsWorkspace(Uri target)
    {
        return address != null && target.Scheme == address.Scheme
            && target.Host == address.Host && target.Port == address.Port && target.UserInfo.Length == 0;
    }

    private static void OpenExternal(Uri target)
    {
        if (target == null || (target.Scheme != Uri.UriSchemeHttp && target.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
        catch (Win32Exception) { MessageBox.Show("無法開啟外部連結。", "校園發聲"); }
    }
}
