const { withSettingsGradle } = require('@expo/config-plugins');

// En un monorepo pnpm, `require.resolve('@react-native/gradle-plugin/package.json')`
// sin el hint `paths` puede fallar a resolver el paquete si el hoisting real de
// node_modules no coincide con lo esperado (isolated vs hoisted) — ya causó un build
// roto una vez. Este plugin fuerza el hint `paths` en cada `expo prebuild` para que
// el build no vuelva a depender de un estado exacto de node_modules.
const BARE_REQUIRE_RESOLVE =
  "require.resolve('@react-native/gradle-plugin/package.json')";
const PATCHED_REQUIRE_RESOLVE =
  "require.resolve('@react-native/gradle-plugin/package.json', { paths: [require.resolve('react-native/package.json')] })";

function withPnpmGradlePluginFix(config) {
  return withSettingsGradle(config, config => {
    if (config.modResults.contents.includes(BARE_REQUIRE_RESOLVE)) {
      config.modResults.contents = config.modResults.contents
        .split(BARE_REQUIRE_RESOLVE)
        .join(PATCHED_REQUIRE_RESOLVE);
    }
    return config;
  });
}

module.exports = withPnpmGradlePluginFix;
