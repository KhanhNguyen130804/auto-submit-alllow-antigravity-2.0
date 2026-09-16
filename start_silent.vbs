' Antigravity Auto-Submit (Silent Background Launcher)
' Khởi chạy ngầm dịch vụ auto-submit không hiện bất kỳ cửa sổ console nào.

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
strCommand = "node """ & strScriptDir & "\auto_submit.js"""

' Chạy lệnh với WindowStyle = 0 (ẩn hoàn toàn) và bWaitOnReturn = False (không chờ kết thúc)
WshShell.CurrentDirectory = strScriptDir
WshShell.Run strCommand, 0, False

Set WshShell = Nothing
Set FSO = Nothing
