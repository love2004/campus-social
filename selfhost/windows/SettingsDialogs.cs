using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class SettingsDialogs
{
    public static bool EditStartupSettings(IWin32Window owner, string path)
    {
        bool existed = File.Exists(path);
        string original = existed ? File.ReadAllText(path) : "# 儲存後重新開啟校園發聲\r\nPORT=5180\r\n";
        using (var dialog = CreateDialog("程式設定", new Size(430, 152)))
        {
            dialog.FormBorderStyle = FormBorderStyle.Sizable;
            dialog.MinimumSize = dialog.Size;
            var hint = new Label
            {
                Dock = DockStyle.Top, Height = 52,
                Text = "在這裡修改本機啟動設定。設定可能含有密碼或金鑰，請在適合的環境顯示內容。",
            };
            var reveal = new Button { Text = "顯示設定內容", AutoSize = true, Dock = DockStyle.Top };
            var editor = new TextBox
            {
                AccessibleName = "啟動設定內容", Dock = DockStyle.Fill, Multiline = true,
                AcceptsReturn = true, ScrollBars = ScrollBars.Both, WordWrap = false, Visible = false,
                Font = new Font("Consolas", 11),
            };
            Button save;
            var buttons = ButtonRow(dialog, "儲存", out save);
            save.Enabled = false;
            dialog.Controls.Add(editor);
            dialog.Controls.Add(reveal);
            dialog.Controls.Add(hint);
            dialog.Controls.Add(buttons);
            reveal.Click += (sender, args) =>
            {
                dialog.ClientSize = new Size(dialog.ClientSize.Width, dialog.ClientSize.Height + 230);
                editor.Text = original;
                editor.Visible = true;
                reveal.Visible = false;
                save.Enabled = true;
                hint.Text = "修改完成後請儲存。重新開啟程式時會讀取最新設定。";
                editor.Focus();
            };
            save.Click += (sender, args) =>
            {
                string temporary = Path.Combine(Path.GetDirectoryName(path), ".env.desktop-" + Guid.NewGuid().ToString("N"));
                try
                {
                    if (File.Exists(path) != existed || (existed && File.ReadAllText(path) != original))
                    {
                        MessageBox.Show(dialog, "設定檔已變更，請重新開啟程式設定。", dialog.Text);
                        return;
                    }
                    File.WriteAllText(temporary, editor.Text, new UTF8Encoding(false));
                    if (existed) File.Replace(temporary, path, null);
                    else File.Move(temporary, path);
                    dialog.DialogResult = DialogResult.OK;
                }
                catch (IOException)
                {
                    MessageBox.Show(dialog, "無法儲存設定，請確認資料夾權限。", dialog.Text);
                }
                catch (UnauthorizedAccessException)
                {
                    MessageBox.Show(dialog, "無法儲存設定，請確認資料夾權限。", dialog.Text);
                }
                finally
                {
                    if (File.Exists(temporary)) File.Delete(temporary);
                }
            };
            return dialog.ShowDialog(owner) == DialogResult.OK;
        }
    }

    public static bool EditAdministrator(IWin32Window owner, bool creating, Func<string, string, Task<string>> saveAccount)
    {
        using (var dialog = CreateDialog(creating ? "建立管理員" : "變更管理員密碼", new Size(430, 242)))
        {
            var fields = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 4 };
            fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 136));
            fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int row = 0; row < 3; row++) fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            fields.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var identity = AddField(fields, 0, creating ? "管理員信箱" : "目前密碼", !creating, creating ? 254 : 500);
            var password = AddField(fields, 1, creating ? "管理員密碼" : "新密碼", true, 500);
            var confirmation = AddField(fields, 2, "再次輸入密碼", true, 500);
            var hint = new Label { Dock = DockStyle.Fill, Text = "密碼至少 12 個字元。" };
            fields.Controls.Add(hint, 0, 3);
            fields.SetColumnSpan(hint, 2);
            Button save;
            var buttons = ButtonRow(dialog, creating ? "建立管理員" : "更新密碼", out save);
            dialog.Controls.Add(fields);
            dialog.Controls.Add(buttons);
            bool waiting = false;
            dialog.FormClosing += (sender, args) => { if (waiting) args.Cancel = true; };
            save.Click += async (sender, args) =>
            {
                string identityValue = creating ? identity.Text.Trim() : identity.Text;
                if (identityValue.Length == 0 || password.Text.Length < 12 || password.Text != confirmation.Text)
                {
                    hint.Text = "請填寫所有欄位，並確認兩次輸入的密碼相同且至少 12 個字元。";
                    return;
                }
                waiting = true;
                fields.Enabled = false;
                buttons.Enabled = false;
                hint.Text = creating ? "正在建立管理員…" : "正在更新密碼…";
                string result = await saveAccount(identityValue, password.Text);
                waiting = false;
                if (result == "CREATED" || result == "EXISTS" || result == "CHANGED" || result == "SIGN_IN_REQUIRED")
                {
                    if (result == "SIGN_IN_REQUIRED")
                        MessageBox.Show(dialog, "密碼已儲存。請用剛設定的密碼登入。", dialog.Text);
                    else if (result == "CHANGED")
                        MessageBox.Show(dialog, "密碼已更新。其他已登入的裝置需要重新登入。", dialog.Text);
                    dialog.DialogResult = DialogResult.OK;
                }
                else
                {
                    if (result == "WRONG_PASSWORD") hint.Text = "目前密碼不正確。";
                    else if (result == "INVALID") hint.Text = creating ? "請確認信箱格式與密碼長度。" : "新密碼須為 12 到 500 個字元。";
                    else hint.Text = "目前無法儲存，請再試一次。";
                    fields.Enabled = true;
                    buttons.Enabled = true;
                }
            };
            return dialog.ShowDialog(owner) == DialogResult.OK;
        }
    }

    private static Form CreateDialog(string title, Size size)
    {
        return new Form
        {
            Text = title, StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog, AutoScaleMode = AutoScaleMode.Font,
            Font = new Font("Microsoft JhengHei UI", 10), Padding = new Padding(16),
            MaximizeBox = false, MinimizeBox = false, ShowInTaskbar = false,
            ClientSize = size,
        };
    }

    private static TextBox AddField(TableLayoutPanel table, int row, string title, bool secret, int limit)
    {
        table.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft }, 0, row);
        var field = new TextBox { AccessibleName = title, Dock = DockStyle.Top, UseSystemPasswordChar = secret, MaxLength = limit };
        table.Controls.Add(field, 1, row);
        return field;
    }

    private static FlowLayoutPanel ButtonRow(Form dialog, string label, out Button save)
    {
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        save = new Button { Text = label, AutoSize = true };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(save);
        dialog.AcceptButton = save;
        dialog.CancelButton = cancel;
        return buttons;
    }
}
