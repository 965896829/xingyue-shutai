const { build } = require('../package.json');

// Loaded explicitly for a Windows release. Keep the installed upgrade identity stable.
module.exports = {
  ...build,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
    signExecutable: false,
    executableName: '星月书台'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    guid: 'abaa7e0a-484b-5222-a08b-20b012130b6d',
    shortcutName: '星月书台',
    uninstallDisplayName: '${productName} ${version}',
    artifactName: '${productName} Setup ${version}.${ext}'
  }
};
