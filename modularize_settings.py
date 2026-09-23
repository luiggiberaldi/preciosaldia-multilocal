import sys

with open(r'src\views\SettingsView.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports after last existing import line
new_imports = (
    "import SettingsTabNegocio from '../components/Settings/tabs/SettingsTabNegocio';\n"
    "import SettingsTabVentas from '../components/Settings/tabs/SettingsTabVentas';\n"
    "import SettingsTabUsuarios from '../components/Settings/tabs/SettingsTabUsuarios';\n"
    "import SettingsTabSistema from '../components/Settings/tabs/SettingsTabSistema';\n"
)

AUDIT_IMPORT = "import { useAudit } from '../hooks/useAudit';"
if new_imports.strip() not in content:
    content = content.replace(AUDIT_IMPORT, AUDIT_IMPORT + '\n' + new_imports)
    print("Added imports.")
else:
    print("Imports already present, skipping.")

# 2. Replace the 4-tab inline block with modular components
# We identify the block by its start (first tab) and end (Version footer comment)
START = "{/* \u2550\u2550\u2550 TAB: NEGOCIO \u2550\u2550\u2550 */}"
END   = "{/* Version footer */}"

start_idx = content.find(START)
end_idx   = content.find(END)

if start_idx == -1 or end_idx == -1:
    print(f"ERROR: markers not found. start={start_idx}, end={end_idx}")
    sys.exit(1)

print(f"Found markers: start_idx={start_idx}, end_idx={end_idx}")

# Get leading whitespace of the START line
line_start = content.rfind('\n', 0, start_idx) + 1
indent = content[line_start:start_idx]

replacement = (
    indent + "{/* \u2550\u2550\u2550 TAB: NEGOCIO \u2550\u2550\u2550 */}\n"
    + indent + "{activeTab === 'negocio' && (\n"
    + indent + "    <SettingsTabNegocio\n"
    + indent + "        businessName={businessName} setBusinessName={setBusinessName}\n"
    + indent + "        businessRif={businessRif} setBusinessRif={setBusinessRif}\n"
    + indent + "        paperWidth={paperWidth} setPaperWidth={setPaperWidth}\n"
    + indent + "        copEnabled={copEnabled} setCopEnabled={setCopEnabled}\n"
    + indent + "        autoCopEnabled={autoCopEnabled} setAutoCopEnabled={setAutoCopEnabled}\n"
    + indent + "        tasaCopManual={tasaCopManual} setTasaCopManual={setTasaCopManual}\n"
    + indent + "        calculatedTasaCop={calculatedTasaCop}\n"
    + indent + "        handleSaveBusinessData={handleSaveBusinessData}\n"
    + indent + "        forceHeartbeat={forceHeartbeat}\n"
    + indent + "        showToast={showToast}\n"
    + indent + "        triggerHaptic={triggerHaptic}\n"
    + indent + "    />\n"
    + indent + ")}\n\n"
    + indent + "{/* \u2550\u2550\u2550 TAB: VENTAS \u2550\u2550\u2550 */}\n"
    + indent + "{activeTab === 'ventas' && (\n"
    + indent + "    <SettingsTabVentas\n"
    + indent + "        allowNegativeStock={allowNegativeStock} setAllowNegativeStock={setAllowNegativeStock}\n"
    + indent + "        forceHeartbeat={forceHeartbeat}\n"
    + indent + "        showToast={showToast}\n"
    + indent + "        triggerHaptic={triggerHaptic}\n"
    + indent + "    />\n"
    + indent + ")}\n\n"
    + indent + "{/* \u2550\u2550\u2550 TAB: USUARIOS \u2550\u2550\u2550 */}\n"
    + indent + "{activeTab === 'usuarios' && isAdmin && (\n"
    + indent + "    <SettingsTabUsuarios\n"
    + indent + "        isCloudConfigured={isCloudConfigured} adminEmail={adminEmail}\n"
    + indent + "        requireLogin={requireLogin} setRequireLogin={setRequireLogin}\n"
    + indent + "        autoLockMinutes={autoLockMinutes} setAutoLockMinutes={setAutoLockMinutes}\n"
    + indent + "        importStatus={importStatus} statusMessage={statusMessage}\n"
    + indent + "        isCloudLogin={isCloudLogin} setIsCloudLogin={setIsCloudLogin}\n"
    + indent + "        inputPhone={inputPhone} setInputPhone={setInputPhone}\n"
    + indent + "        inputEmail={inputEmail} setInputEmail={setInputEmail}\n"
    + indent + "        emailError={emailError} setEmailError={setEmailError}\n"
    + indent + "        inputPassword={inputPassword} setInputPassword={setInputPassword}\n"
    + indent + "        passwordError={passwordError} setPasswordError={setPasswordError}\n"
    + indent + "        showPassword={showPassword} setShowPassword={setShowPassword}\n"
    + indent + "        isRecoveringPassword={isRecoveringPassword} setIsRecoveringPassword={setIsRecoveringPassword}\n"
    + indent + "        handleSaveCloudAccount={handleSaveCloudAccount}\n"
    + indent + "        handleResetPasswordRequest={handleResetPasswordRequest}\n"
    + indent + "        setAdminCredentials={setAdminCredentials}\n"
    + indent + "        showToast={showToast}\n"
    + indent + "        triggerHaptic={triggerHaptic}\n"
    + indent + "    />\n"
    + indent + ")}\n\n"
    + indent + "{/* \u2550\u2550\u2550 TAB: SISTEMA \u2550\u2550\u2550 */}\n"
    + indent + "{activeTab === 'sistema' && (\n"
    + indent + "    <SettingsTabSistema\n"
    + indent + "        theme={theme} toggleTheme={toggleTheme}\n"
    + indent + "        deviceId={deviceId} idCopied={idCopied} setIdCopied={setIdCopied}\n"
    + indent + "        isAdmin={isAdmin}\n"
    + indent + "        importStatus={importStatus} statusMessage={statusMessage}\n"
    + indent + "        handleExport={handleExport}\n"
    + indent + "        handleImportClick={handleImportClick}\n"
    + indent + "        setIsShareOpen={setIsShareOpen}\n"
    + indent + "        setShowDeleteConfirm={setShowDeleteConfirm}\n"
    + indent + "        triggerHaptic={triggerHaptic}\n"
    + indent + "    />\n"
    + indent + ")}\n\n"
    + indent + "{/* Version footer */}"
)

content = content[:start_idx] + replacement + content[end_idx + len(END):]

with open(r'src\views\SettingsView.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"SUCCESS: SettingsView.jsx modularized. New size: {len(content)} bytes")
