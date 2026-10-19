(() => {
  const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
  const expected = 'D:\\AIkehuduan\\.test-output\\optimization-20261010\\electron 用户 空格';
  if (electron.app.getPath('userData') !== expected) throw new Error('Unexpected Electron profile');
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['D:\\AIkehuduan\\.test-output\\optimization-20261010\\large.docx'] });
  return { appPath: electron.app.getAppPath(), version: electron.app.getVersion(), profile: electron.app.getPath('userData'), dialogFixture: true };
})()
