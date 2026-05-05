; El Sbobinator — Inno Setup installer script
; Compiled by CI via: ISCC /DAppVersion=X.Y.Z installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B348000F-C12F-4F17-9130-FF166C04EADF}
AppName=El Sbobinator
AppVersion={#AppVersion}
AppPublisher=vimuw
AppPublisherURL=https://github.com/vimuw/El-Sbobinator
AppSupportURL=https://github.com/vimuw/El-Sbobinator/issues
AppUpdatesURL=https://github.com/vimuw/El-Sbobinator/releases
DefaultDirName={userpf}\El Sbobinator
DefaultGroupName=El Sbobinator
SourceDir={#SourcePath}\..\..
OutputDir=dist
OutputBaseFilename=El-Sbobinator-Setup-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\El Sbobinator.exe
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\El Sbobinator\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\El Sbobinator"; Filename: "{app}\El Sbobinator.exe"
Name: "{userdesktop}\El Sbobinator"; Filename: "{app}\El Sbobinator.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Run]
Filename: "{app}\El Sbobinator.exe"; Description: "{cm:LaunchProgram,El Sbobinator}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
{ ------------------------------------------------------------------ }
{ One-time migration: remove a previous HKLM (admin) install so that }
{ the new per-user install does not leave two copies on disk.         }
{ The old AppId key is the same GUID with _is1 appended by Inno.     }
{ ------------------------------------------------------------------ }
const
  ADMIN_UNINSTALL_KEY =
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\' +
    '{B348000F-C12F-4F17-9130-FF166C04EADF}_is1';

function GetAdminUninstallString(): String;
var
  sValue: String;
begin
  sValue := '';
  { Prefer the 64-bit hive (normal location for x64 installs). }
  if not RegQueryStringValue(HKLM64, ADMIN_UNINSTALL_KEY, 'UninstallString', sValue) then
    RegQueryStringValue(HKLM, ADMIN_UNINSTALL_KEY, 'UninstallString', sValue);
  Result := sValue;
end;

procedure MigrateFromAdminInstall();
var
  sUninstaller: String;
  iResultCode: Integer;
begin
  sUninstaller := GetAdminUninstallString();
  if sUninstaller = '' then
    Exit;
  sUninstaller := RemoveQuotes(sUninstaller);
  { ShellExec 'open' lets Windows apply the uninstaller's UAC manifest, }
  { so the OS will prompt for elevation if the old exe requires it.     }
  ShellExec('open', sUninstaller, '/SILENT /NORESTART', '',
            SW_HIDE, ewWaitUntilTerminated, iResultCode);
end;

function InitializeSetup(): Boolean;
begin
  MigrateFromAdminInstall();
  Result := True;
end;
