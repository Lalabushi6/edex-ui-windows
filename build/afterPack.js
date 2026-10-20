// electron-builder afterPack hook: stamps the eDEX icon and version details
// onto eDEX-UI.exe with rcedit. electron-builder's own resource editing needs
// its winCodeSign bundle, which can't be unpacked on Windows without
// Developer Mode, so it is turned off (win.signAndEditExecutable: false) and
// done here instead. Works the same locally and on GitHub Actions.
"use strict";

const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const { appInfo } = context.packager;
  const exe = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.info.projectDir, "build", "icon.ico");
  const { rcedit } = await import("rcedit");
  await rcedit(exe, {
    icon,
    "file-version": appInfo.shortVersionWindows || appInfo.version,
    "product-version": appInfo.shortVersionWindows || appInfo.version,
    "requested-execution-level": "asInvoker",
    "version-string": {
      ProductName: appInfo.productName,
      FileDescription: appInfo.productName,
      CompanyName: appInfo.companyName || appInfo.productName,
      LegalCopyright: appInfo.copyright || "",
      OriginalFilename: `${appInfo.productFilename}.exe`,
      InternalName: appInfo.productFilename
    }
  });
};
