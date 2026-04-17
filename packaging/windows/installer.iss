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
DefaultDirName={autopf}\El Sbobinator
DefaultGroupName=El Sbobinator
SourceDir={#SourcePath}\..\..
OutputDir=dist
OutputBaseFilename=El-Sbobinator-Setup-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\El Sbobinator.exe
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\El Sbobinator\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\El Sbobinator"; Filename: "{app}\El Sbobinator.exe"
Name: "{commondesktop}\El Sbobinator"; Filename: "{app}\El Sbobinator.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Run]
Filename: "{app}\El Sbobinator.exe"; Description: "{cm:LaunchProgram,El Sbobinator}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
