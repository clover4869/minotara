const { withAndroidManifest } = require('@expo/config-plugins');

/** Strips permissions Expo's base manifest template adds unconditionally (see @expo/config-plugins/build/plugins/withAndroidBaseMods.js) that app.json's `android.permissions` array cannot remove, only add to. */
module.exports = function withRemoveAndroidPermissions(config, permissionsToRemove) {
  return withAndroidManifest(config, (config) => {
    const usesPermission = config.modResults.manifest['uses-permission'];
    if (usesPermission) {
      config.modResults.manifest['uses-permission'] = usesPermission.filter(
        (perm) => !permissionsToRemove.includes(perm.$['android:name'])
      );
    }
    return config;
  });
};
