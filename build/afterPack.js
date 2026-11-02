// Com signAndEditExecutable desligado o electron-builder não troca o ícone do .exe: grava aqui com o rcedit
const path = require('path');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename, productName, version, companyName } = context.packager.appInfo;
  await rcedit(path.join(context.appOutDir, `${productFilename}.exe`), {
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    'version-string': { ProductName: productName, FileDescription: productName, CompanyName: companyName || '' },
    'product-version': version,
    'file-version': version,
  });
};
