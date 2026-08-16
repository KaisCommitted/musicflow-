#define MyAppName "Musicflow"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "Musicflow"
#define MyAppExeName "Musicflow.exe"

[Setup]
AppId={{B8F3A1D2-7C4E-4F5A-9E2B-1A3D5C7F9E0B}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=MusicflowSetup-{#MyAppVersion}
SetupIconFile=music.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequiredOverridesAllowed=dialog

; Update behavior: same AppId allows upgrading in-place
UsePreviousAppDir=yes
CloseApplications=force
RestartApplications=no
CloseApplicationsFilter=Musicflow.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
function CompareVersions(V1, V2: String): Integer;
var
  P1, P2: Integer;
  N1, N2: Integer;
  S1, S2: String;
begin
  Result := 0;
  S1 := V1;
  S2 := V2;
  while (S1 <> '') or (S2 <> '') do
  begin
    P1 := Pos('.', S1);
    if P1 > 0 then begin N1 := StrToIntDef(Copy(S1, 1, P1 - 1), 0); S1 := Copy(S1, P1 + 1, Length(S1)); end
    else begin N1 := StrToIntDef(S1, 0); S1 := ''; end;
    P2 := Pos('.', S2);
    if P2 > 0 then begin N2 := StrToIntDef(Copy(S2, 1, P2 - 1), 0); S2 := Copy(S2, P2 + 1, Length(S2)); end
    else begin N2 := StrToIntDef(S2, 0); S2 := ''; end;
    if N1 < N2 then begin Result := -1; Exit; end;
    if N1 > N2 then begin Result := 1; Exit; end;
  end;
end;

function InitializeSetup(): Boolean;
var
  InstalledVersion: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
    'DisplayVersion', InstalledVersion) then
  begin
    if CompareVersions(InstalledVersion, '{#MyAppVersion}') >= 0 then
    begin
      MsgBox('{#MyAppName} ' + InstalledVersion + ' is already installed.' + #13#10 +
        'This installer is version {#MyAppVersion}.' + #13#10 +
        'Please use a newer version to upgrade.', mbInformation, MB_OK);
      Result := False;
    end;
  end;
end;
